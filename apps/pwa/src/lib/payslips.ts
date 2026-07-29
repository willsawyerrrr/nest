import {
  latestReportedYearToDate,
  paygWithheldByMember,
  payslipAttributionDate,
  payslipVariance,
  payslipYearPositions,
  payslipYearToDate,
  payslipYearToDateByMember,
  type PayslipAttribution,
  type PayslipLine,
  type PayslipTotals,
  type PayslipTotalsRow,
  type PayslipVariance,
  type PayslipYearPositions,
  type PayslipYearToDateTotals,
  type ReconciledInflow,
} from '@nest/plan'
import { financialYearForDate, type MemberTaxEstimate, type TaxYearConfig } from '@nest/tax'
import type { Inflow } from '../hooks/useInflows'
import type { PayslipLineRow } from '../hooks/usePayslipLines'
import type { PayslipRow } from '../hooks/usePayslips'
import { formatIsoDate } from './dates'
import { toIncomeInput } from './tax'

/**
 * A payslip's inclusive pay period as a short date range — the label a slip is
 * named by wherever it is listed, headed, or confirmed for deletion.
 */
export function periodLabel(payslip: Pick<PayslipRow, 'period_start' | 'period_end'>): string {
  return `${formatIsoDate(payslip.period_start)} – ${formatIsoDate(payslip.period_end)}`
}

/**
 * The AU financial year a payslip is filed under, labelled by its ending year:
 * the year the slip's attribution date falls in — the date the pay landed, or the
 * pay period's last day where the slip states no payment date. Salary and wages
 * are assessed in the year they are paid, so a fortnight worked to 28 June and
 * paid 1 July is filed under the later year. The date is read as a UTC instant,
 * matching the engine's own UTC financial-year bounds.
 */
export function financialYearForPayslip(payslip: PayslipAttribution): number {
  return financialYearForDate(new Date(`${payslipAttributionDate(payslip)}T00:00:00Z`))
}

/** Maps a `payslip` row to the aggregation shape `@nest/plan` reads. */
export function toPayslipTotalsRow(payslip: PayslipRow): PayslipTotalsRow {
  return {
    memberId: payslip.member_id,
    paidOn: payslip.paid_on,
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
 * Each member's summed actual tax withheld from their payslip rows — every slip's
 * tax total, PAYG plus any STSL — keyed by member id. This is the map the tax
 * estimate nets against each member's liability to report a refund or an amount
 * owing. A member with no payslips is absent, so their estimate keeps its nil
 * withholding.
 */
export function paygWithheldFromRows(payslips: readonly PayslipRow[]): ReadonlyMap<string, number> {
  return paygWithheldByMember(payslips.map(toPayslipTotalsRow))
}

/**
 * How many payslips each member has among `payslips`, keyed by member id. A
 * member with none is absent, which is what separates a year whose slips are all
 * entered and withheld nothing from a year with no slips entered at all — the two
 * both sum to nil withholding, and only one of them means the estimate's balance
 * is a real refund or bill.
 */
export function payslipCountByMember(payslips: readonly PayslipRow[]): ReadonlyMap<string, number> {
  return new Map(
    [...payslipYearToDateByMember(payslips.map(toPayslipTotalsRow))].map(
      ([memberId, totals]) => [memberId, totals.payslipCount] as const,
    ),
  )
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
 * Maps an `inflows` row to the projection a payslip's earnings lines are measured
 * against: the tax engine's own income shape, whether employer super accrues on it
 * (which a line snapshots when it is written), and the cadence the money arrives on.
 * That last is the one thing the tax engine has no use for — it annualises the
 * amount over the frequency the amount is expressed in — and the one thing a pay
 * period is measured against, so it is added here rather than to `IncomeInput`.
 */
export function toReconciledInflow(inflow: Inflow): ReconciledInflow {
  return {
    ...toIncomeInput(inflow),
    attractsSuper: inflow.attracts_super,
    ...(inflow.pay_schedule != null && { paySchedule: inflow.pay_schedule }),
    ...(inflow.pay_interval_count != null && { payInterval: inflow.pay_interval_count }),
  }
}

/**
 * Maps a `payslip_line` row to the line `@nest/plan` groups and sums. The
 * database's pairing check constraint is what makes the two shapes total: a tax
 * line always carries the component it pays and never an inflow, and an earnings
 * line always carries the ordinary-time-earnings decision its trigger snapshotted.
 */
export function toPayslipLine(line: PayslipLineRow): PayslipLine {
  if (line.kind === 'tax') {
    return {
      kind: 'tax',
      component: line.tax_component!,
      label: line.label,
      amountCents: line.amount_cents,
    }
  }
  return {
    kind: 'earning',
    sourceInflowId: line.source_inflow_id,
    label: line.label,
    amountCents: line.amount_cents,
    attractsSuper: line.attracts_super!,
  }
}

/**
 * The household-wide lookups every payslip card reads. Built once for a screenful
 * of slips rather than per card: each is a pass over the household's whole inflow
 * or line list, which a per-slip rebuild turns into a scan per slip.
 */
export interface PayslipReconciliation {
  /** Every inflow keyed by id, so a slip resolves the projection it draws on. */
  readonly inflowsById: ReadonlyMap<string, ReconciledInflow>
  /** Each payslip's own lines, in the order they were entered. */
  readonly linesByPayslip: ReadonlyMap<string, PayslipLineRow[]>
  /** Every inflow's name keyed by id, for naming a slip's earnings-line groups. */
  readonly inflowNames: ReadonlyMap<string, string>
}

/** Builds the {@link PayslipReconciliation} lookups from the household's rows. */
export function payslipReconciliation(
  inflows: readonly Inflow[],
  lines: readonly PayslipLineRow[],
): PayslipReconciliation {
  const linesByPayslip = new Map<string, PayslipLineRow[]>()
  for (const line of lines) {
    const forPayslip = linesByPayslip.get(line.payslip_id)
    if (forPayslip) {
      forPayslip.push(line)
    } else {
      linesByPayslip.set(line.payslip_id, [line])
    }
  }
  return {
    inflowsById: new Map(inflows.map((inflow) => [inflow.id, toReconciledInflow(inflow)])),
    linesByPayslip,
    inflowNames: new Map(inflows.map((inflow) => [inflow.id, inflow.name])),
  }
}

/**
 * Measures one payslip row against the plan: each of its earnings lines held
 * against the projection it draws on, each of its tax lines against the component
 * of the estimated liability it pays, its printed tax total against the whole of
 * that liability, and the config's super guarantee — charged on the gross less
 * every non-OTE line — plus the member's modelled concessional contributions.
 * Nothing mapping to a projection leaves the gross expectation null, and an absent
 * member estimate expects nothing withheld or contributed.
 */
export function payslipVarianceFor(
  payslip: PayslipRow,
  { inflowsById, linesByPayslip }: PayslipReconciliation,
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
      lines: (linesByPayslip.get(payslip.id) ?? []).map(toPayslipLine),
    },
    {
      inflowsById,
      annualTaxCents: estimate?.annualTaxCents ?? 0,
      annualHelpRepaymentCents: estimate?.breakdown.helpRepaymentCents ?? 0,
      annualConcessionalContributionsCents: estimate?.annualConcessionalContributionsCents ?? 0,
      superConfig: config.super,
    },
  )
}

/**
 * Each of a member's payslips measured against the plan, keyed by slip id. One
 * measurement per slip, which both the slip's own card and the member's year-to-date
 * position read, so a total can never disagree with the figures it sums.
 */
export function payslipVariancesById(
  payslips: readonly PayslipRow[],
  reconciliation: PayslipReconciliation,
  estimate: MemberTaxEstimate | undefined,
  config: TaxYearConfig,
): ReadonlyMap<string, PayslipVariance> {
  return new Map(
    payslips.map((payslip) => [
      payslip.id,
      payslipVarianceFor(payslip, reconciliation, estimate, config),
    ]),
  )
}

/**
 * A member's year to date against the plan, read off the same per-slip
 * measurements their cards show. A slip absent from `variances` is not measured
 * and so takes no part in the year, exactly as a slip with no expectation does.
 */
export function payslipYearPositionsFromRows(
  payslips: readonly PayslipRow[],
  variances: ReadonlyMap<string, PayslipVariance>,
): PayslipYearPositions {
  return payslipYearPositions(
    payslips.flatMap((payslip) => {
      const variance = variances.get(payslip.id)
      return variance === undefined
        ? []
        : [
            {
              grossCents: payslip.gross_cents,
              taxWithheldCents: payslip.tax_withheld_cents,
              variance,
            },
          ]
    }),
  )
}
