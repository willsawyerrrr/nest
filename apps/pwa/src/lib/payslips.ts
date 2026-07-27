import {
  latestReportedYearToDate,
  paygWithheldByMember,
  payslipVariance,
  payslipYearToDate,
  type PayslipTotals,
  type PayslipTotalsRow,
  type PayslipVariance,
  type PayslipYearToDateTotals,
} from '@nest/plan'
import { financialYearForDate, type MemberTaxEstimate, type TaxYearConfig } from '@nest/tax'
import type { Inflow } from '../hooks/useInflows'
import type { PayslipRow } from '../hooks/usePayslips'
import { toIncomeInput } from './tax'

/**
 * The AU financial year a pay period is filed under, labelled by its ending year:
 * the year the period's last day (an ISO `YYYY-MM-DD` date) falls in, so a period
 * straddling 30 June belongs to the year it ends in. The date is read as a UTC
 * instant, matching the engine's own UTC financial-year bounds.
 */
export function financialYearForPayPeriod(periodEnd: string): number {
  return financialYearForDate(new Date(`${periodEnd}T00:00:00Z`))
}

/** Maps a `payslip` row to the aggregation shape `@nest/plan` reads. */
export function toPayslipTotalsRow(payslip: PayslipRow): PayslipTotalsRow {
  return {
    memberId: payslip.member_id,
    periodEnd: payslip.period_end,
    grossCents: payslip.gross_cents,
    taxWithheldCents: payslip.tax_withheld_cents,
    superCents: payslip.super_cents,
    salarySacrificeCents: payslip.salary_sacrifice_cents,
    ytdGrossCents: payslip.ytd_gross_cents,
    ytdTaxWithheldCents: payslip.ytd_tax_withheld_cents,
    ytdSuperCents: payslip.ytd_super_cents,
  }
}

/**
 * Each member's summed actual PAYG withheld from their payslip rows, keyed by
 * member id — the map the tax estimate nets against each member's liability to
 * report a refund or an amount owing. A member with no payslips is absent, so
 * their estimate keeps its nil withholding.
 */
export function paygWithheldFromRows(payslips: readonly PayslipRow[]): ReadonlyMap<string, number> {
  return paygWithheldByMember(payslips.map(toPayslipTotalsRow))
}

/** The actual totals summed from `payslips` — the year-to-date source of truth. */
export function payslipTotalsFromRows(payslips: readonly PayslipRow[]): PayslipTotals {
  return payslipYearToDate(payslips.map(toPayslipTotalsRow))
}

/**
 * The running totals printed on the latest payslip that carries all three, or
 * null when none does — a cross-check on the summed totals that accounts for
 * slips never entered.
 */
export function reportedYearToDateFromRows(
  payslips: readonly PayslipRow[],
): PayslipYearToDateTotals | null {
  return latestReportedYearToDate(payslips.map(toPayslipTotalsRow))
}

/**
 * Measures one payslip row against the plan: its reconciled inflow's projected
 * gross for the period, its member's estimated tax as the implied withholding,
 * and the config's super guarantee plus their modelled concessional
 * contributions. An absent inflow leaves the gross expectation null — there is no
 * projection to compare — and an absent member estimate expects nothing withheld
 * or contributed.
 */
export function payslipVarianceFor(
  payslip: PayslipRow,
  inflow: Inflow | undefined,
  estimate: MemberTaxEstimate | undefined,
  config: TaxYearConfig,
): PayslipVariance {
  return payslipVariance(
    {
      financialYear: payslip.financial_year,
      periodStart: payslip.period_start,
      periodEnd: payslip.period_end,
      grossCents: payslip.gross_cents,
      taxWithheldCents: payslip.tax_withheld_cents,
      superCents: payslip.super_cents,
      salarySacrificeCents: payslip.salary_sacrifice_cents,
    },
    {
      inflow: inflow ? toIncomeInput(inflow) : null,
      annualTaxCents: estimate?.annualTaxCents ?? 0,
      annualConcessionalContributionsCents: estimate?.annualConcessionalContributionsCents ?? 0,
      superConfig: config.super,
    },
  )
}
