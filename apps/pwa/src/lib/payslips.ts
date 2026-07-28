import {
  latestReportedYearToDate,
  paygWithheldByMember,
  payslipVariance,
  payslipYearToDate,
  type PayslipLine,
  type PayslipTotals,
  type PayslipTotalsRow,
  type PayslipVariance,
  type PayslipYearToDateTotals,
  type ReconciledInflow,
} from '@nest/plan'
import { financialYearForDate, type MemberTaxEstimate, type TaxYearConfig } from '@nest/tax'
import type { Inflow } from '../hooks/useInflows'
import type { PayslipLineRow } from '../hooks/usePayslipLines'
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
 * Maps an `inflows` row to the projection a payslip is measured against: the tax
 * engine's own income shape plus whether employer super accrues on it, which
 * decides if the inflow's lines count toward the slip's super base.
 */
export function toReconciledInflow(inflow: Inflow): ReconciledInflow {
  return { ...toIncomeInput(inflow), attractsSuper: inflow.attracts_super }
}

/** Every inflow keyed by id, so a payslip line resolves the projection it draws on. */
export function reconciledInflowsById(
  inflows: readonly Inflow[],
): ReadonlyMap<string, ReconciledInflow> {
  return new Map(inflows.map((inflow) => [inflow.id, toReconciledInflow(inflow)]))
}

/** Maps a `payslip_line` row to the earnings line `@nest/plan` groups and sums. */
export function toPayslipLine(line: PayslipLineRow): PayslipLine {
  return {
    sourceInflowId: line.source_inflow_id,
    label: line.label,
    amountCents: line.amount_cents,
  }
}

/** The lines belonging to one payslip, in the order they were entered. */
export function linesForPayslip(
  lines: readonly PayslipLineRow[],
  payslipId: string,
): PayslipLineRow[] {
  return lines.filter((line) => line.payslip_id === payslipId)
}

/**
 * Measures one payslip row against the plan: each of its earnings lines held
 * against the projection it draws on, its member's estimated tax as the implied
 * withholding, and the config's super guarantee — charged on the gross less every
 * non-OTE line — plus their modelled concessional contributions. A slip with no
 * lines is measured whole against the inflow its `source_inflow_id` names; either
 * way, nothing mapping to a projection leaves the gross expectation null, and an
 * absent member estimate expects nothing withheld or contributed.
 */
export function payslipVarianceFor(
  payslip: PayslipRow,
  lines: readonly PayslipLineRow[],
  inflows: readonly Inflow[],
  estimate: MemberTaxEstimate | undefined,
  config: TaxYearConfig,
): PayslipVariance {
  const inflowsById = reconciledInflowsById(inflows)
  return payslipVariance(
    {
      financialYear: payslip.financial_year,
      periodStart: payslip.period_start,
      periodEnd: payslip.period_end,
      grossCents: payslip.gross_cents,
      taxWithheldCents: payslip.tax_withheld_cents,
      superCents: payslip.super_cents,
      salarySacrificeCents: payslip.salary_sacrifice_cents,
      lines: linesForPayslip(lines, payslip.id).map(toPayslipLine),
    },
    {
      inflow:
        payslip.source_inflow_id === null
          ? null
          : (inflowsById.get(payslip.source_inflow_id) ?? null),
      inflowsById,
      annualTaxCents: estimate?.annualTaxCents ?? 0,
      annualConcessionalContributionsCents: estimate?.annualConcessionalContributionsCents ?? 0,
      superConfig: config.super,
    },
  )
}
