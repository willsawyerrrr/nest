import { annualCents, isActiveOn } from '@nest/plan'
import {
  annualGrossCents,
  configsByYear,
  estimateHouseholdTax,
  financialYearForDate,
  FY2027_CONFIG,
  projectHelpPayoff,
  splitOneOffPayment,
  superCoContribution,
  type OneOffTaxTreatment as EngineOneOffTaxTreatment,
  type HelpPayoffProjection,
  type HouseholdTaxEstimate,
  type IncomeInput,
  type Residency,
  type TaxBreakdown,
  type TaxProfileInput,
  type TaxYearConfig,
} from '@nest/tax'
import type { DeductionRow } from '../hooks/useDeductions'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { Inflow, OneOffTaxTreatment } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { SuperContribution } from '../hooks/useSuperContributions'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import type { TaxProfile } from '../hooks/useTaxProfiles'

/** The tax engine's income types; any other inflow type is treated as `other`. */
const TAXABLE_INCOME_TYPES = new Set<IncomeInput['type']>(['salary', 'wage', 'other'])

/** Each stored tax treatment as the engine names it. */
export const ENGINE_ONE_OFF_TREATMENTS: Record<OneOffTaxTreatment, EngineOneOffTaxTreatment> = {
  ordinary: 'ordinary',
  genuine_redundancy: 'genuineRedundancy',
  employment_termination: 'employmentTermination',
  unused_leave: 'unusedLeave',
}

/**
 * Whether a member born on `dateOfBirth` had reached `config`'s preservation age by
 * `onDate`, which is what chooses between the two concessional rates on a
 * termination payment. An unknown date of birth reads as below it — the higher rate,
 * so a missing figure understates the payment rather than the tax on it.
 */
export function atPreservationAgeOn(
  dateOfBirth: string | null,
  onDate: string,
  config: TaxYearConfig,
): boolean {
  if (dateOfBirth === null) {
    return false
  }
  const reached = new Date(`${dateOfBirth}T00:00:00Z`)
  reached.setUTCFullYear(reached.getUTCFullYear() + config.super.preservationAge)
  return new Date(`${onDate}T00:00:00Z`) >= reached
}

/**
 * Maps an `inflow` row to the tax engine's `IncomeInput`. Only taxable inflows reach
 * the tax estimate, so the type is only ever salary, wage, or other; any non-taxable
 * label is coerced to `other` for safety.
 *
 * A ONE-OFF carries `paidOn` and the concession it is assessed under in place of a
 * cadence, which is what tells the engine to count its whole amount in the year that
 * date falls in rather than annualising anything. `atPreservationAge` is the
 * member's age at that date decided by the caller (see {@link atPreservationAgeOn}),
 * defaulting to the higher-rate reading.
 */
export function toIncomeInput(inflow: Inflow, atPreservationAge = false): IncomeInput {
  return {
    memberId: inflow.member_id ?? '',
    type: TAXABLE_INCOME_TYPES.has(inflow.type as IncomeInput['type'])
      ? (inflow.type as IncomeInput['type'])
      : 'other',
    ...(inflow.schedule != null && { schedule: inflow.schedule }),
    ...(inflow.amount_cents != null && { amountCents: inflow.amount_cents }),
    ...(inflow.hourly_rate_cents != null && { hourlyRateCents: inflow.hourly_rate_cents }),
    ...(inflow.hours_per_period != null && { hoursPerPeriod: inflow.hours_per_period }),
    ...(inflow.interval_count != null && { interval: inflow.interval_count }),
    ...(inflow.starts_on != null && { startsOn: inflow.starts_on }),
    ...(inflow.ends_on != null && { endsOn: inflow.ends_on }),
    ...(inflow.paid_on != null && {
      paidOn: inflow.paid_on,
      treatment: ENGINE_ONE_OFF_TREATMENTS[inflow.one_off_tax_treatment ?? 'ordinary'],
      atPreservationAge,
      ...(inflow.years_of_service != null && { yearsOfService: inflow.years_of_service }),
    }),
  }
}

/**
 * The taxable inflows the fortnightly budget basis is estimated over: the income
 * landing NOW, each at its full annual rate. A recurring inflow is kept only
 * while `now` falls within its effective window (either side open-ended), with
 * `starts_on` / `ends_on` cleared so the engine annualises it at the full rate
 * rather than its FY-active share — a salary that ended months ago or starts
 * months from now is dropped entirely rather than smeared into the buffer. A
 * ONE-OFF is passed through unchanged: it states a date, not a cadence, so no
 * fortnight was ever owed a share of it and it is already out of the fortnightly
 * basis. Non-taxable inflows are dropped — they never reach the tax engine.
 *
 * The whole-year tax estimate keeps reading the inflows as they are, windows and
 * all; only this second, budget-only estimate reads the active-now set.
 */
export function activeNowTaxableInflows(inflows: readonly Inflow[], now: Date): Inflow[] {
  return inflows.flatMap((inflow) => {
    if (!inflow.taxable) {
      return []
    }
    if (inflow.paid_on != null) {
      return [inflow]
    }
    if (!isActiveOn({ startsOn: inflow.starts_on, endsOn: inflow.ends_on }, now)) {
      return []
    }
    return [{ ...inflow, starts_on: null, ends_on: null }]
  })
}

/**
 * Maps a `tax_profile` row to the tax engine's `TaxProfileInput`. The member's
 * HELP balance lives in a separate `help_debt` row, threaded in as
 * `helpDebtCents`.
 */
function toTaxProfileInput(profile: TaxProfile, helpDebtCents: number): TaxProfileInput {
  const residency: Residency =
    profile.residency === 'foreign_resident' ? 'foreignResident' : 'resident'
  return {
    memberId: profile.member_id,
    residency,
    privateHospitalCover: profile.has_private_hospital_cover,
    helpDebtCents,
  }
}

/** Each member's HELP balance in cents, keyed by member id. */
export function helpDebtCentsByMember(helpDebts: readonly HelpDebt[]): Map<string, number> {
  return new Map(helpDebts.map((debt) => [debt.member_id, debt.balance_cents]))
}

/** Each member's total annual deductions in cents, summed from their deduction rows. */
export function deductionsByMember(deductions: readonly DeductionRow[]): Map<string, number> {
  const byMember = new Map<string, number>()
  for (const deduction of deductions) {
    byMember.set(
      deduction.member_id,
      (byMember.get(deduction.member_id) ?? 0) + deduction.amount_cents,
    )
  }
  return byMember
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
        : annualCents(row.amount_cents ?? 0, row.frequency, row.interval_count ?? undefined)
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

/** Every financial year with a published tax config, most recent first. */
export const availableFinancialYears: readonly number[] = Object.keys(configsByYear)
  .map(Number)
  .sort((a, b) => b - a)

/**
 * What one taxable inflow adds to a member's annual assessable income, `income`
 * being the row already mapped to the engine's shape: a recurring inflow's steady
 * annual rate (not FY-prorated by effective dates, a super base
 * being set against the current rate rather than a part-year figure), or — for a
 * ONE-OFF — the assessable part of the payment, a genuine redundancy's tax-free
 * amount excluded, and nil where the payment lands outside `config`'s financial
 * year.
 *
 * The assessable part is the same figure whatever else the member earns; only the
 * CONCESSIONAL part turns on their other income, and that has no bearing here. So
 * the payments need no ordering and the other-income argument is nil.
 */
function annualAssessableCents(inflow: Inflow, income: IncomeInput, config: TaxYearConfig): number {
  if (inflow.paid_on == null) {
    return annualGrossCents(income)
  }
  return splitOneOffPayment(
    {
      treatment: ENGINE_ONE_OFF_TREATMENTS[inflow.one_off_tax_treatment ?? 'ordinary'],
      amountCents: annualGrossCents(income, config.financialYear),
      ...(inflow.years_of_service != null && { yearsOfService: inflow.years_of_service }),
    },
    0,
    config,
  ).assessableCents
}

/** Sums each member's annual assessable income from the taxable inflows `include` accepts. */
function annualByMemberFromInflows(
  inflows: readonly Inflow[],
  include: (inflow: Inflow) => boolean,
  config: TaxYearConfig,
): Map<string, number> {
  const byMember = new Map<string, number>()
  for (const inflow of inflows) {
    if (!inflow.taxable || !include(inflow)) {
      continue
    }
    const income = toIncomeInput(inflow)
    byMember.set(
      income.memberId,
      (byMember.get(income.memberId) ?? 0) + annualAssessableCents(inflow, income, config),
    )
  }
  return byMember
}

/**
 * Per-member annual ordinary time earnings: the base the employer super guarantee
 * is charged on, and the salary a percent-of-salary contribution is a percentage
 * of. An inflow marked `attracts_super = false` — an allowance such as on-call —
 * is excluded from both, because no guarantee accrues on it and a sacrifice set
 * as a percentage of salary is not set against an allowance.
 *
 * A ONE-OFF is excluded on the same reasoning: no employer super accrues on a
 * termination payment or a bonus paid on the way out, and a contribution set as a
 * percentage of salary is set against the salary, not against money that lands once.
 */
function grossByMemberFromInflows(
  inflows: readonly Inflow[],
  config: TaxYearConfig,
): Map<string, number> {
  return annualByMemberFromInflows(
    inflows,
    (inflow) => inflow.attracts_super && inflow.paid_on == null,
    config,
  )
}

/**
 * Per-member annual assessable income: every taxable inflow, whether or not super
 * accrues on it, and one-offs included. This is the co-contribution income test's
 * base, which is the member's total income — an allowance is assessable in full, as
 * is the assessable part of a one-off, so leaving either out over-states the
 * entitlement. On $45,000 of salary plus $12,000 of on-call, the ordinary-time base
 * alone reads $45,000 and awards the whole $500 where the taper on $57,000 allows
 * $243.10.
 */
function assessableByMemberFromInflows(
  inflows: readonly Inflow[],
  config: TaxYearConfig,
): Map<string, number> {
  return annualByMemberFromInflows(inflows, () => true, config)
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
 * Builds each member's `SuperCapSummary` from their annual contributions and
 * super profile. An entry is produced for every member with a contribution or a
 * super profile. The concessional cap adds the profile's
 * `carry_forward_cap_cents`. The two income bases are distinct: `grossByMember`
 * is ordinary time earnings, the salary a percent-mode contribution is set
 * against, while `assessableByMember` is total assessable income, which the
 * co-contribution's income test is on.
 */
export function superCapSummaryByMember(
  contributions: readonly SuperContribution[],
  profiles: readonly SuperProfile[],
  grossByMember: ReadonlyMap<string, number>,
  assessableByMember: ReadonlyMap<string, number>,
  config: TaxYearConfig,
): Map<string, SuperCapSummary> {
  const concessional = concessionalByMember(contributions, grossByMember)
  const nonConcessional = nonConcessionalByMember(contributions, grossByMember)
  const carryForwardByMember = new Map(
    profiles.map((profile) => [profile.member_id, profile.carry_forward_cap_cents]),
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
        assessableByMember.get(memberId) ?? 0,
        config,
      ),
    })
  }
  return summaries
}

/**
 * Resolves each member's `SuperCapSummary` from raw inflow, profile, and
 * contribution rows, using `config` (defaulting to the current financial year,
 * falling back to FY2027). Annual ordinary time earnings drive percent-mode
 * contributions; total assessable income drives the co-contribution income test.
 */
export function superCapSummaryFromRows(
  inflows: readonly Inflow[],
  profiles: readonly SuperProfile[],
  contributions: readonly SuperContribution[],
  config: TaxYearConfig = currentTaxConfig(),
): Map<string, SuperCapSummary> {
  return superCapSummaryByMember(
    contributions,
    profiles,
    grossByMemberFromInflows(inflows, config),
    assessableByMemberFromInflows(inflows, config),
    config,
  )
}

/**
 * Per member, the annual amount landing in super net of the 15% contributions
 * tax: after-tax concessional (member's concessional contributions plus employer
 * super guarantee on their gross salary, both taxed at `contributionsTaxRate`)
 * plus non-concessional contributions and the government co-contribution, which
 * are made from after-tax money and so are not taxed again in the fund. An entry
 * is produced for every member with a contribution or gross salary. This feeds
 * the retirement projection as the annual amount added to their balance.
 *
 * `grossByMember` is ordinary time earnings — the base employer SG is charged on
 * and a percent-mode contribution is set against — while `assessableByMember` is
 * total assessable income, which the co-contribution's income test is on.
 */
export function netAnnualSuperContributionByMember(
  contributions: readonly SuperContribution[],
  grossByMember: ReadonlyMap<string, number>,
  assessableByMember: ReadonlyMap<string, number>,
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
    const coContributionCents = superCoContribution(
      nonConcessionalCents,
      assessableByMember.get(memberId) ?? 0,
      config,
    )
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
 * back to FY2027). Annual ordinary time earnings drive employer SG and
 * percent-mode contributions; total assessable income drives the co-contribution
 * income test.
 */
export function netAnnualSuperContributionFromRows(
  inflows: readonly Inflow[],
  contributions: readonly SuperContribution[],
): Map<string, number> {
  const config = currentTaxConfig()
  return netAnnualSuperContributionByMember(
    contributions,
    grossByMemberFromInflows(inflows, config),
    assessableByMemberFromInflows(inflows, config),
    config,
  )
}

/**
 * Estimates the household's tax for a financial year from raw inflow,
 * tax-profile, and HELP-debt rows, using `config` (defaulting to the current
 * financial year, falling back to FY2027). Only taxable inflows feed the
 * estimate. Each member's HELP balance is threaded in from `helpDebts`; a
 * member with a HELP balance but no tax profile still contributes a resident,
 * cover-less profile so their repayment is assessed. Concessional super
 * contributions, when supplied, reduce each member's taxable income and
 * after-tax cash; deductions, when supplied, reduce each member's taxable
 * income only (so tax falls and after-tax cash rises). `paygWithheld`, when
 * supplied, gives each member's actual tax withheld for the year — summed from
 * their payslips, each slip's tax total including any STSL — which the engine nets
 * against their liability as
 * `breakdown.balanceCents` (positive owing, negative a refund). It changes no tax
 * figure: omitting it leaves every liability and after-tax total identical.
 * `members`, when supplied, gives each member's date of birth, which decides the
 * concessional rate on a one-off termination payment; a member whose date of birth
 * is absent or unset is read as below preservation age — the higher rate.
 */
export function estimateHouseholdTaxFromRows(
  inflows: readonly Inflow[],
  profiles: readonly TaxProfile[],
  contributions: readonly SuperContribution[] = [],
  helpDebts: readonly HelpDebt[] = [],
  deductions: readonly DeductionRow[] = [],
  config: TaxYearConfig = currentTaxConfig(),
  paygWithheld?: ReadonlyMap<string, number>,
  // Narrowed to what this reads (id, date_of_birth) rather than the full
  // `Member` row, so the EOFY share view — whose members carry no email or
  // user_id — can call this with exactly the same result the household's own
  // tab gets.
  members: readonly Pick<Member, 'id' | 'date_of_birth'>[] = [],
): HouseholdTaxEstimate {
  // Keyed to allow a null member id, which a taxable inflow can carry: it simply
  // matches no member, and an unknown date of birth reads as the higher rate.
  const dateOfBirthByMember = new Map<string | null, string | null>(
    members.map((member) => [member.id, member.date_of_birth]),
  )
  const incomes = inflows
    .filter((inflow) => inflow.taxable)
    .map((inflow) =>
      toIncomeInput(
        inflow,
        inflow.paid_on != null &&
          atPreservationAgeOn(
            dateOfBirthByMember.get(inflow.member_id) ?? null,
            inflow.paid_on,
            config,
          ),
      ),
    )
  // Per-member annual gross salary, the base for percent-of-salary contributions.
  const grossByMember = grossByMemberFromInflows(inflows, config)
  const helpByMember = helpDebtCentsByMember(helpDebts)
  const profileInputByMember = new Map(
    profiles.map((profile) => [
      profile.member_id,
      toTaxProfileInput(profile, helpByMember.get(profile.member_id) ?? 0),
    ]),
  )
  // A member with a HELP balance but no tax profile still needs their repayment
  // assessed, so synthesise a default profile carrying that balance.
  for (const [memberId, helpDebtCents] of helpByMember) {
    if (helpDebtCents > 0 && !profileInputByMember.has(memberId)) {
      profileInputByMember.set(memberId, {
        memberId,
        residency: 'resident',
        privateHospitalCover: false,
        helpDebtCents,
      })
    }
  }
  return estimateHouseholdTax(
    incomes,
    [...profileInputByMember.values()],
    config,
    concessionalByMember(contributions, grossByMember),
    deductionsByMember(deductions),
    paygWithheld,
  )
}

/** Years the HELP/HECS payoff projection runs before giving up on clearing the debt. */
export const HELP_PAYOFF_MAX_YEARS = 40

/**
 * Projects when a member's HELP/HECS debt is paid off, holding their repayment
 * income (from the tax breakdown) constant and starting from the financial year
 * `now` falls in. `config` reuses the current year's rates for every future year.
 */
export function helpPayoffForBreakdown(
  breakdown: TaxBreakdown,
  balanceCents: number,
  config: TaxYearConfig,
  now: Date = new Date(),
): HelpPayoffProjection {
  return projectHelpPayoff(
    balanceCents,
    breakdown.repaymentIncomeCents,
    config,
    financialYearForDate(now),
    HELP_PAYOFF_MAX_YEARS,
  )
}

/**
 * A one-line, user-facing summary of a HELP/HECS payoff projection: the financial
 * year and years-to-go when it clears, or a note that it does not clear within the
 * projection horizon at the member's current income.
 */
export function helpPayoffSummary(projection: HelpPayoffProjection): string {
  if (projection.paidOffFinancialYear !== null) {
    const years = projection.yearsToPayOff ?? 0
    return `HELP debt projected paid off in FY${projection.paidOffFinancialYear} (${years} year${
      years === 1 ? '' : 's'
    })`
  }
  return `HELP debt not cleared within ${HELP_PAYOFF_MAX_YEARS} years at current income`
}

/**
 * Each member's HELP/HECS payoff projection, keyed by member id, for those whose
 * HELP balance is positive. Members without a HELP debt are omitted.
 */
export function helpPayoffByMember(
  estimate: HouseholdTaxEstimate,
  helpDebts: readonly HelpDebt[],
  config: TaxYearConfig = currentTaxConfig(),
  now: Date = new Date(),
): Map<string, HelpPayoffProjection> {
  const balanceByMember = helpDebtCentsByMember(helpDebts)
  const byMember = new Map<string, HelpPayoffProjection>()
  for (const member of estimate.members) {
    const balanceCents = balanceByMember.get(member.memberId) ?? 0
    if (balanceCents > 0) {
      byMember.set(
        member.memberId,
        helpPayoffForBreakdown(member.breakdown, balanceCents, config, now),
      )
    }
  }
  return byMember
}
