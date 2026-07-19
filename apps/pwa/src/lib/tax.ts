import {
  annualGrossCents,
  configsByYear,
  estimateHouseholdTax,
  financialYearForDate,
  FY2027_CONFIG,
  superCoContribution,
  type HouseholdTaxEstimate,
  type IncomeInput,
  type Residency,
  type TaxProfileInput,
  type TaxYearConfig,
} from '@budget/tax'
import { annualCents } from '@budget/plan'
import type { Inflow } from '../hooks/useInflows'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import type { SuperContribution } from '../hooks/useSuperContributions'

/** The tax engine's income types; any other inflow type is treated as `other`. */
const TAXABLE_INCOME_TYPES = new Set<IncomeInput['type']>(['salary', 'wage', 'other'])

/**
 * Maps a taxable `inflow` row to the tax engine's `IncomeInput`. Only taxable
 * inflows reach the tax estimate, so the type is only ever salary, wage, or
 * other; any non-taxable label is coerced to `other` for safety.
 */
export function toIncomeInput(inflow: Inflow): IncomeInput {
  return {
    memberId: inflow.member_id ?? '',
    type: TAXABLE_INCOME_TYPES.has(inflow.type as IncomeInput['type'])
      ? (inflow.type as IncomeInput['type'])
      : 'other',
    schedule: inflow.schedule,
    amountCents: inflow.amount_cents ?? undefined,
    hourlyRateCents: inflow.hourly_rate_cents ?? undefined,
    hoursPerPeriod: inflow.hours_per_period ?? undefined,
    intervalWeeks: inflow.interval_weeks ?? undefined,
  }
}

/** Maps a `tax_profile` row to the tax engine's `TaxProfileInput`. */
export function toTaxProfileInput(profile: TaxProfile): TaxProfileInput {
  const residency: Residency =
    profile.residency === 'foreign_resident' ? 'foreignResident' : 'resident'
  return {
    memberId: profile.member_id,
    residency,
    privateHospitalCover: profile.has_private_hospital_cover,
    helpDebtCents: profile.help_debt_cents,
  }
}

/** The contribution kinds that reduce taxable income (concessional super). */
const CONCESSIONAL_KINDS = new Set<SuperContribution['kind']>([
  'salary_sacrifice',
  'personal_deductible',
])

/** The contribution kind that counts toward the non-concessional cap. */
const NON_CONCESSIONAL_KINDS = new Set<SuperContribution['kind']>(['personal_non_concessional'])

/**
 * Sums each member's annual super for the matching `kinds`. An amount-mode row is
 * annualised by its frequency; a percent-mode row is `percent_bp / 10000 ×` the
 * member's annual gross salary (from `grossByMember`, defaulting to zero).
 */
function annualByMember(
  contributions: readonly SuperContribution[],
  grossByMember: ReadonlyMap<string, number>,
  kinds: ReadonlySet<SuperContribution['kind']>,
): Map<string, number> {
  const byMember = new Map<string, number>()
  for (const row of contributions) {
    if (!kinds.has(row.kind)) {
      continue
    }
    const annual =
      row.mode === 'percent'
        ? Math.round(((row.percent_bp ?? 0) / 10_000) * (grossByMember.get(row.member_id) ?? 0))
        : annualCents(row.amount_cents ?? 0, row.frequency, row.interval_weeks ?? undefined)
    byMember.set(row.member_id, (byMember.get(row.member_id) ?? 0) + annual)
  }
  return byMember
}

/**
 * Resolves each member's annual concessional super from their contribution rows,
 * summing only the concessional kinds (salary sacrifice and personal deductible).
 * Non-concessional and spouse contributions are excluded.
 */
export function concessionalByMember(
  contributions: readonly SuperContribution[],
  grossByMember: ReadonlyMap<string, number>,
): Map<string, number> {
  return annualByMember(contributions, grossByMember, CONCESSIONAL_KINDS)
}

/**
 * Resolves each member's annual personal non-concessional (after-tax) super from
 * their contribution rows. Only the `personal_non_concessional` kind counts;
 * concessional and spouse contributions are excluded.
 */
export function nonConcessionalByMember(
  contributions: readonly SuperContribution[],
  grossByMember: ReadonlyMap<string, number>,
): Map<string, number> {
  return annualByMember(contributions, grossByMember, NON_CONCESSIONAL_KINDS)
}

/**
 * The verified tax + super config for the current financial year, falling back
 * to FY2027 for years without a published config.
 */
export function currentTaxConfig(): TaxYearConfig {
  return configsByYear[financialYearForDate(new Date())] ?? FY2027_CONFIG
}

/** Per-member annual gross salary from the household's taxable inflows. */
export function grossByMemberFromInflows(inflows: readonly Inflow[]): Map<string, number> {
  const grossByMember = new Map<string, number>()
  for (const inflow of inflows) {
    if (!inflow.taxable) {
      continue
    }
    const income = toIncomeInput(inflow)
    grossByMember.set(
      income.memberId,
      (grossByMember.get(income.memberId) ?? 0) + annualGrossCents(income),
    )
  }
  return grossByMember
}

/**
 * A member's contribution-cap status for the financial year: how much of each cap
 * their annual contributions use, whether either is exceeded, and their estimated
 * government co-contribution. The concessional cap includes the member's manual
 * carry-forward from prior years; the non-concessional cap is the config cap only
 * (bring-forward, up to 3×, is surfaced as an informational note, not modelled).
 */
export interface SuperCapSummary {
  concessionalCents: number
  concessionalCapCents: number
  concessionalOverCap: boolean
  nonConcessionalCents: number
  nonConcessionalCapCents: number
  nonConcessionalOverCap: boolean
  coContributionCents: number
}

/**
 * Builds each member's `SuperCapSummary` from their annual contributions, super
 * profile, and annual assessable income. An entry is produced for every member
 * with a contribution or a super profile. The concessional cap adds the profile's
 * `carry_forward_cap_cents`; the co-contribution uses the member's annual gross
 * (from taxable inflows) as their approximate total income.
 */
export function superCapSummaryByMember(
  contributions: readonly SuperContribution[],
  profiles: readonly SuperProfile[],
  grossByMember: ReadonlyMap<string, number>,
  config: TaxYearConfig,
): Map<string, SuperCapSummary> {
  const concessional = concessionalByMember(contributions, grossByMember)
  const nonConcessional = nonConcessionalByMember(contributions, grossByMember)
  const carryForwardByMember = new Map(
    profiles.map((profile) => [profile.member_id, profile.carry_forward_cap_cents ?? 0]),
  )
  const memberIds = new Set<string>([
    ...concessional.keys(),
    ...nonConcessional.keys(),
    ...profiles.map((profile) => profile.member_id),
  ])
  const summaries = new Map<string, SuperCapSummary>()
  for (const memberId of memberIds) {
    const concessionalCents = concessional.get(memberId) ?? 0
    const nonConcessionalCents = nonConcessional.get(memberId) ?? 0
    const concessionalCapCents =
      config.super.concessionalCapCents + (carryForwardByMember.get(memberId) ?? 0)
    const nonConcessionalCapCents = config.super.nonConcessionalCapCents
    summaries.set(memberId, {
      concessionalCents,
      concessionalCapCents,
      concessionalOverCap: concessionalCents > concessionalCapCents,
      nonConcessionalCents,
      nonConcessionalCapCents,
      nonConcessionalOverCap: nonConcessionalCents > nonConcessionalCapCents,
      coContributionCents: superCoContribution(
        nonConcessionalCents,
        grossByMember.get(memberId) ?? 0,
        config,
      ),
    })
  }
  return summaries
}

/**
 * Resolves each member's `SuperCapSummary` from raw inflow, profile, and
 * contribution rows, using the config for the current financial year (falling
 * back to FY2027). Annual gross salary drives both percent-mode contributions and
 * the co-contribution income test.
 */
export function superCapSummaryFromRows(
  inflows: readonly Inflow[],
  profiles: readonly SuperProfile[],
  contributions: readonly SuperContribution[],
): Map<string, SuperCapSummary> {
  const config = currentTaxConfig()
  return superCapSummaryByMember(contributions, profiles, grossByMemberFromInflows(inflows), config)
}

/**
 * Per member, the annual amount landing in super net of the 15% contributions
 * tax: after-tax concessional (member's concessional contributions plus employer
 * super guarantee on their gross salary, both taxed at `contributionsTaxRate`)
 * plus non-concessional contributions and the government co-contribution, which
 * are made from after-tax money and so are not taxed again in the fund. An entry
 * is produced for every member with a contribution or gross salary. This feeds
 * the retirement projection as the annual amount added to their balance.
 */
export function netAnnualSuperContributionByMember(
  contributions: readonly SuperContribution[],
  grossByMember: ReadonlyMap<string, number>,
  config: TaxYearConfig,
): Map<string, number> {
  const concessional = concessionalByMember(contributions, grossByMember)
  const nonConcessional = nonConcessionalByMember(contributions, grossByMember)
  const memberIds = new Set<string>([
    ...concessional.keys(),
    ...nonConcessional.keys(),
    ...grossByMember.keys(),
  ])
  const netByMember = new Map<string, number>()
  for (const memberId of memberIds) {
    const concessionalCents = concessional.get(memberId) ?? 0
    const nonConcessionalCents = nonConcessional.get(memberId) ?? 0
    const grossCents = grossByMember.get(memberId) ?? 0
    const employerSgCents = config.super.guaranteeRate * grossCents
    const afterTaxConcessional =
      (concessionalCents + employerSgCents) * (1 - config.super.contributionsTaxRate)
    const coContributionCents = superCoContribution(nonConcessionalCents, grossCents, config)
    netByMember.set(
      memberId,
      Math.round(afterTaxConcessional) + nonConcessionalCents + coContributionCents,
    )
  }
  return netByMember
}

/**
 * Resolves each member's net annual super contribution from raw inflow and
 * contribution rows, using the config for the current financial year (falling
 * back to FY2027). Annual gross salary drives employer SG, percent-mode
 * contributions, and the co-contribution income test.
 */
export function netAnnualSuperContributionFromRows(
  inflows: readonly Inflow[],
  contributions: readonly SuperContribution[],
): Map<string, number> {
  const config = currentTaxConfig()
  return netAnnualSuperContributionByMember(
    contributions,
    grossByMemberFromInflows(inflows),
    config,
  )
}

/**
 * Estimates the household's tax for the current financial year from raw inflow
 * and tax-profile rows, using the config for the year (falling back to FY2027).
 * Only taxable inflows feed the estimate. Concessional super contributions, when
 * supplied, reduce each member's taxable income and after-tax cash.
 */
export function estimateHouseholdTaxFromRows(
  inflows: readonly Inflow[],
  profiles: readonly TaxProfile[],
  contributions: readonly SuperContribution[] = [],
): HouseholdTaxEstimate {
  const config = currentTaxConfig()
  const incomes = inflows.filter((inflow) => inflow.taxable).map(toIncomeInput)
  // Per-member annual gross salary, the base for percent-of-salary contributions.
  const grossByMember = grossByMemberFromInflows(inflows)
  return estimateHouseholdTax(
    incomes,
    profiles.map(toTaxProfileInput),
    config,
    concessionalByMember(contributions, grossByMember),
  )
}
