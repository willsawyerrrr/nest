import {
  configsByYear,
  estimateHouseholdTax,
  financialYearForDate,
  FY2027_CONFIG,
  type HouseholdTaxEstimate,
  type IncomeInput,
  type Residency,
  type TaxProfileInput,
} from '@budget/tax'
import type { Inflow } from '../hooks/useInflows'
import type { TaxProfile } from '../hooks/useTaxProfiles'

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

/**
 * Estimates the household's tax for the current financial year from raw inflow
 * and tax-profile rows, using the config for the year (falling back to FY2027).
 * Only taxable inflows feed the estimate.
 */
export function estimateHouseholdTaxFromRows(
  inflows: readonly Inflow[],
  profiles: readonly TaxProfile[],
): HouseholdTaxEstimate {
  const config = configsByYear[financialYearForDate(new Date())] ?? FY2027_CONFIG
  return estimateHouseholdTax(
    inflows.filter((inflow) => inflow.taxable).map(toIncomeInput),
    profiles.map(toTaxProfileInput),
    config,
  )
}
