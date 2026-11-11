import {
  estimateHouseholdTaxFromRows,
  toIncomeInput,
  type DeductionRow,
  type HelpDebtRow,
  type InflowRow,
  type MemberRow,
  type SuperContributionRow,
  type TaxProfileRow,
} from '@nest/household'
import {
  latestReportedYearToDate,
  payslipVariance,
  payslipYearPositions,
  payslipYearToDate,
  unmeasuredInflowPositions,
  type Frequency,
  type PayslipLine,
  type PayslipTotals,
  type PayslipTotalsRow,
  type PayslipVariance,
  type PayslipYearPositions,
  type PayslipYearToDateTotals,
  type ReconciledInflow,
  type UnmeasuredInflowPosition,
} from '@nest/plan'
import { configsByYear, FY2027_CONFIG } from '@nest/tax'

/** The `inflows` columns a payslip's earnings are measured against. */
export interface PayslipInflowRow extends InflowRow {
  id: string
  attracts_super: boolean
  arrives_every_pay_period: boolean
  pay_schedule: string | null
  pay_interval_count: number | null
}

/** The `payslip` columns the measurements read. */
export interface PayslipInputRow {
  id: string
  member_id: string
  financial_year: number
  period_start: string
  period_end: string
  paid_on: string | null
  gross_cents: number
  tax_withheld_cents: number
  super_cents: number
  salary_sacrifice_cents: number | null
  ytd_gross_cents: number | null
  ytd_tax_withheld_cents: number | null
  ytd_super_cents: number | null
}

/** The `payslip_line` columns the measurements read. */
export interface PayslipLineInputRow {
  payslip_id: string
  kind: 'earning' | 'tax'
  source_inflow_id: string | null
  tax_component: 'payg' | 'stsl' | null
  label: string
  amount_cents: number
  attracts_super: boolean | null
}

/** The input of {@link payslipsOverview}: the financial year's rows and the estimate's. */
export interface PayslipsInput {
  financialYear: number
  members: MemberRow[]
  inflows: PayslipInflowRow[]
  taxProfiles: TaxProfileRow[]
  contributions: SuperContributionRow[]
  helpDebts: HelpDebtRow[]
  deductions: DeductionRow[]
  payslips: PayslipInputRow[]
  lines: PayslipLineInputRow[]
}

/** One member's payslips measured against the plan, and their year to date. */
export interface MemberPayslipsOverview {
  memberId: string
  /** Each of the member's payslips' variances, in the input's order. */
  variances: { payslipId: string; variance: PayslipVariance }[]
  totals: PayslipTotals
  reported: PayslipYearToDateTotals | null
  positions: PayslipYearPositions
  unmeasured: UnmeasuredInflowPosition[]
}

function totalsRow(payslip: PayslipInputRow): PayslipTotalsRow {
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

function reconciledInflow(inflow: PayslipInflowRow): ReconciledInflow {
  return {
    ...toIncomeInput(inflow),
    attractsSuper: inflow.attracts_super,
    arrivesEveryPayPeriod: inflow.arrives_every_pay_period,
    ...(inflow.pay_schedule != null && { paySchedule: inflow.pay_schedule as Frequency }),
    ...(inflow.pay_interval_count != null && { payInterval: inflow.pay_interval_count }),
  }
}

function payslipLine(line: PayslipLineInputRow): PayslipLine {
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
 * Every member's payslips for the financial year measured against the plan: each
 * slip's variance against the household tax estimate (the PWA's own measurement),
 * and the member's year to date, reported running totals and the year's position on
 * pay no period measures.
 */
export function payslipsOverview(input: PayslipsInput) {
  const config = configsByYear[input.financialYear] ?? FY2027_CONFIG
  const estimate = estimateHouseholdTaxFromRows(
    input.inflows,
    input.taxProfiles,
    input.contributions,
    input.helpDebts,
    input.deductions,
    config,
    undefined,
    input.members,
  )
  const inflowsById = new Map(
    input.inflows.map((inflow) => [inflow.id, reconciledInflow(inflow)] as const),
  )
  const linesByPayslip = new Map<string, PayslipLine[]>()
  for (const line of input.lines) {
    const forPayslip = linesByPayslip.get(line.payslip_id)
    if (forPayslip) {
      forPayslip.push(payslipLine(line))
    } else {
      linesByPayslip.set(line.payslip_id, [payslipLine(line)])
    }
  }

  const members: MemberPayslipsOverview[] = input.members.map((member) => {
    const payslips = input.payslips.filter((payslip) => payslip.member_id === member.id)
    const memberEstimate = estimate.members.find((each) => each.memberId === member.id)
    const measured = payslips.map((payslip) => ({
      payslip,
      variance: payslipVariance(
        {
          financialYear: payslip.financial_year,
          periodStart: payslip.period_start,
          periodEnd: payslip.period_end,
          grossCents: payslip.gross_cents,
          taxWithheldCents: payslip.tax_withheld_cents,
          superCents: payslip.super_cents,
          salarySacrificeCents: payslip.salary_sacrifice_cents,
          lines: linesByPayslip.get(payslip.id) ?? [],
        },
        {
          inflowsById,
          annualTaxCents: memberEstimate?.annualTaxCents ?? 0,
          annualHelpRepaymentCents: memberEstimate?.breakdown.helpRepaymentCents ?? 0,
          annualConcessionalContributionsCents:
            memberEstimate?.annualConcessionalContributionsCents ?? 0,
          superConfig: config.super,
        },
      ),
    }))
    const rows = payslips.map(totalsRow)
    return {
      memberId: member.id,
      variances: measured.map(({ payslip, variance }) => ({ payslipId: payslip.id, variance })),
      totals: payslipYearToDate(rows),
      reported: latestReportedYearToDate(rows),
      positions: payslipYearPositions(
        measured.map(({ payslip, variance }) => ({
          grossCents: payslip.gross_cents,
          taxWithheldCents: payslip.tax_withheld_cents,
          variance,
        })),
      ),
      unmeasured: [
        ...unmeasuredInflowPositions(
          measured.map(({ payslip, variance }) => ({
            paidOn: payslip.paid_on,
            periodEnd: payslip.period_end,
            variance,
          })),
          inflowsById,
          input.financialYear,
        ),
      ],
    }
  })
  return { members }
}
