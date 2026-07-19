import {
  annualGrossCents,
  configsByYear,
  estimateHouseholdTax,
  financialYearForDate,
  FY2027_CONFIG,
  type HouseholdTaxEstimate,
  type IncomeInput,
  type Residency,
  type TaxProfileInput,
} from '@budget/tax'
import { annualCents } from '@budget/plan'
import type { Inflow } from '../hooks/useInflows'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import type { SuperContribution } from '../hooks/useSuperContributions'

/**
 * Maps a taxable `inflow` row to the tax engine's `IncomeInput`. Only taxable
 * inflows reach the tax estimate, so the type is never `reimbursement` here.
 */
export function toIncomeInput(inflow: Inflow): IncomeInput {
  return {
    memberId: inflow.member_id ?? '',
    type: inflow.type as 'salary' | 'wage' | 'other',
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

/**
 * Resolves each member's annual concessional super from their contribution rows,
 * summing only the concessional kinds (salary sacrifice and personal deductible).
 * An amount-mode row is annualised by its frequency; a percent-mode row is
 * `percent_bp / 10000 ×` the member's annual gross salary (from `grossByMember`,
 * defaulting to zero). Non-concessional and spouse contributions are excluded.
 */
export function concessionalByMember(
  contributions: readonly SuperContribution[],
  grossByMember: ReadonlyMap<string, number>,
): Map<string, number> {
  const byMember = new Map<string, number>()
  for (const row of contributions) {
    if (!CONCESSIONAL_KINDS.has(row.kind)) {
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
  const config = configsByYear[financialYearForDate(new Date())] ?? FY2027_CONFIG
  const incomes = inflows.filter((inflow) => inflow.taxable).map(toIncomeInput)
  // Per-member annual gross salary, the base for percent-of-salary contributions.
  const grossByMember = new Map<string, number>()
  for (const income of incomes) {
    grossByMember.set(
      income.memberId,
      (grossByMember.get(income.memberId) ?? 0) + annualGrossCents(income),
    )
  }
  return estimateHouseholdTax(
    incomes,
    profiles.map(toTaxProfileInput),
    config,
    concessionalByMember(contributions, grossByMember),
  )
}
