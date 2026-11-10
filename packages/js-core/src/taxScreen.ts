import {
  availableFinancialYears,
  currentTaxConfig,
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  helpPayoffSummary,
  projectedInterestIncomeInputs,
  superCapSummaryFromRows,
  type DeductionRow,
  type EquityRows,
  type HelpDebtRow,
  type InflowRow,
  type InterestGoalRow,
  type MemberRow,
  type SaverRow,
  type SuperCapSummary,
  type SuperContributionRow,
  type SuperProfileRow,
  type TaxProfileRow,
  type TradeRow,
} from '@nest/household'
import { paygWithheldByMember, payslipYearToDateByMember, type PayslipTotalsRow } from '@nest/plan'
import {
  configsByYear,
  familyMedicareLevySurcharge,
  householdYearSummary,
  salarySacrificeWhatIf,
  type HelpPayoffProjection,
  type HouseholdTaxEstimate,
  type MemberTaxEstimate,
} from '@nest/tax'

/** The `payslip` columns the withholding and payslip count read. */
export interface PayslipRow {
  member_id: string
  paid_on: string | null
  period_end: string
  gross_cents: number
  tax_withheld_cents: number
  super_cents: number
  salary_sacrifice_cents: number | null
  ytd_gross_cents: number | null
  ytd_tax_withheld_cents: number | null
  ytd_super_cents: number | null
}

/** The rows the Tax estimate and EOFY screens are built from, for one financial year. */
export interface TaxScreenInput {
  /** The financial year's ending calendar year; the year's config prices the estimate. */
  financialYear: number
  /** ISO 8601 instant the HELP payoff projection starts from. */
  now: string
  inflows: InflowRow[]
  taxProfiles: TaxProfileRow[]
  contributions: SuperContributionRow[]
  superProfiles: SuperProfileRow[]
  helpDebts: HelpDebtRow[]
  deductions: DeductionRow[]
  members: MemberRow[]
  payslips: PayslipRow[]
  interestGoals: InterestGoalRow[]
  interestSavers: SaverRow[]
  trades: TradeRow[]
  equity: EquityRows
  /** Planning mode: the real inflows and goals, estimated again for the `real → proposed` moves. */
  baseline?: { inflows: InflowRow[]; interestGoals: InterestGoalRow[] }
}

/** Maps a `payslip` row to the aggregation shape `@nest/plan` reads, as the PWA's `toPayslipTotalsRow` does. */
function toPayslipTotalsRow(payslip: PayslipRow): PayslipTotalsRow {
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

function configOf(input: TaxScreenInput) {
  return configsByYear[input.financialYear] ?? currentTaxConfig()
}

function estimateOf(
  input: TaxScreenInput,
  inflows: InflowRow[],
  interestGoals: InterestGoalRow[],
): { estimate: HouseholdTaxEstimate; interestCentsByMember: Map<string, number> } {
  const interestIncomes = projectedInterestIncomeInputs(
    interestGoals,
    input.interestSavers,
    input.members,
  )
  const interestCentsByMember = new Map<string, number>()
  for (const income of interestIncomes) {
    interestCentsByMember.set(
      income.memberId,
      (interestCentsByMember.get(income.memberId) ?? 0) + (income.amountCents ?? 0),
    )
  }
  const estimate = estimateHouseholdTaxFromRows(
    inflows,
    input.taxProfiles,
    input.contributions,
    input.helpDebts,
    input.deductions,
    configOf(input),
    paygWithheldByMember(input.payslips.map(toPayslipTotalsRow)),
    input.members,
    interestIncomes,
    input.trades,
    input.equity,
  )
  return { estimate, interestCentsByMember }
}

/** A member's estimate as the screens read it: the scalar figures and the whole tax breakdown. */
function projectMember(member: MemberTaxEstimate) {
  return {
    memberId: member.memberId,
    annualGrossCents: member.annualGrossCents,
    annualConcessionalContributionsCents: member.annualConcessionalContributionsCents,
    annualDeductionsCents: member.annualDeductionsCents,
    annualTaxCents: member.annualTaxCents,
    annualAfterTaxCents: member.annualAfterTaxCents,
    annualOneOffGrossCents: member.annualOneOffGrossCents,
    annualNetCapitalGainCents: member.annualNetCapitalGainCents,
    fortnightlyGrossCents: member.fortnightlyGrossCents,
    fortnightlyTaxCents: member.fortnightlyTaxCents,
    fortnightlyAfterTaxCents: member.fortnightlyAfterTaxCents,
    employmentTerminationCents: member.input.assessableIncome.employmentTerminationCents,
    breakdown: { ...member.breakdown },
  }
}

function projectHousehold(estimate: HouseholdTaxEstimate) {
  return {
    annualGrossCents: estimate.annualGrossCents,
    annualTaxCents: estimate.annualTaxCents,
    annualAfterTaxCents: estimate.annualAfterTaxCents,
    annualOneOffGrossCents: estimate.annualOneOffGrossCents,
    fortnightlyGrossCents: estimate.fortnightlyGrossCents,
    fortnightlyTaxCents: estimate.fortnightlyTaxCents,
    fortnightlyAfterTaxCents: estimate.fortnightlyAfterTaxCents,
    members: estimate.members.map(projectMember),
  }
}

function projectPayoff(projection: HelpPayoffProjection) {
  return {
    paidOffFinancialYear: projection.paidOffFinancialYear,
    yearsToPayOff: projection.yearsToPayOff,
    summary: helpPayoffSummary(projection),
  }
}

/**
 * The Tax estimate and EOFY screens' figures for `input`'s rows: the household
 * and each member's estimate with its tax breakdown, each member's contribution-cap
 * summary, HELP payoff projection, projected savings interest and payslip count,
 * the financial years with a config and the year's deduction rates, and, in
 * planning mode, the estimate of the real rows.
 */
export function taxScreen(input: TaxScreenInput) {
  const config = configOf(input)
  const { estimate, interestCentsByMember } = estimateOf(input, input.inflows, input.interestGoals)
  const capSummaries: Map<string, SuperCapSummary> = superCapSummaryFromRows(
    input.inflows,
    input.superProfiles,
    input.contributions,
    config,
    input.members,
  )
  const helpPayoff = helpPayoffByMember(estimate, input.helpDebts, config, new Date(input.now))
  const payslipCounts = payslipYearToDateByMember(input.payslips.map(toPayslipTotalsRow))
  const baseline = input.baseline
    ? estimateOf(input, input.baseline.inflows, input.baseline.interestGoals).estimate
    : undefined
  return {
    financialYear: input.financialYear,
    availableFinancialYears: [...availableFinancialYears],
    deductionRates: {
      centsPerKm: config.carExpense.centsPerKm,
      centsPerHour: config.workFromHome.centsPerHour,
    },
    estimate: projectHousehold(estimate),
    baseline: baseline ? projectHousehold(baseline) : null,
    memberExtras: estimate.members.map((member) => ({
      memberId: member.memberId,
      capSummary: capSummaries.get(member.memberId) ?? null,
      helpPayoff: helpPayoff.has(member.memberId)
        ? projectPayoff(helpPayoff.get(member.memberId)!)
        : null,
      projectedInterestCents: interestCentsByMember.get(member.memberId) ?? 0,
      payslipCount: payslipCounts.get(member.memberId)?.payslipCount ?? 0,
    })),
  }
}

/** The input of {@link salarySacrifice}. */
export interface SalarySacrificeInput extends TaxScreenInput {
  memberId: string
  /** The extra annual pre-tax super contribution, in cents. */
  extraCents: number
}

/** The member's salary-sacrifice what-if for `extraCents` more concessional super. */
export function salarySacrifice(input: SalarySacrificeInput) {
  const member = estimateOf(input, input.inflows, input.interestGoals).estimate.members.find(
    (candidate) => candidate.memberId === input.memberId,
  )
  if (!member) {
    throw new Error('unknown member')
  }
  return salarySacrificeWhatIf(member.input, input.extraCents, configOf(input))
}

/** The input of {@link mlsWhatIf} and {@link householdYear}. */
export interface DependentChildrenInput extends TaxScreenInput {
  dependentChildren: number
}

/** The family Medicare levy surcharge if no member held private hospital cover. */
export function mlsWhatIf(input: DependentChildrenInput) {
  const { estimate } = estimateOf(input, input.inflows, input.interestGoals)
  return familyMedicareLevySurcharge(
    estimate.members.map((member) => ({
      incomeForSurchargeCents: member.breakdown.incomeForSurchargeCents,
      hasPrivateHospitalCover: false,
    })),
    input.dependentChildren,
    configOf(input),
  )
}

/** The household's combined year figures and its Medicare levy surcharge test. */
export function householdYear(input: DependentChildrenInput) {
  const { estimate } = estimateOf(input, input.inflows, input.interestGoals)
  return householdYearSummary(estimate, input.dependentChildren, configOf(input))
}
