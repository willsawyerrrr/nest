/**
 * Payslip reconciliation: what the plan expected for a pay period against what
 * the payslip actually reported, and the year-to-date actuals the tax estimate's
 * refund/bill position is computed from.
 *
 * A slip is itemised into lines, and the lines carry the whole of its
 * reconciliation. One payment routinely covers several projections at once —
 * salary plus an on-call allowance — so each earnings line names the inflow it
 * draws on, and gross variance is measured per inflow: the lines naming one
 * inflow are summed and held against that inflow's expectation, keeping a steady
 * salary's variance at nil while a lumpy allowance's stands on its own. A slip's
 * tax is itemised the same way, each tax line naming the component of the
 * liability it pays, so the STSL that pays down HELP is measured against the
 * compulsory repayment and the PAYG against the income tax and levies that are
 * the rest.
 *
 * Expected figures rest on one of two bases. A pay period that matches the pay
 * cycle the slip's lines are drawn on — the ordinary case — divides the annual
 * figure by the cadence's periods per year, the way an employer pays it, so a
 * slip that matches the projection shows nil variance. Every other period is
 * genuine partial-year apportionment — a part period, a first or last slip in a
 * job, an off-cycle or back-pay slip, or a slip whose lines name no projection at
 * all — and prorates by inclusive calendar days in the period over inclusive
 * calendar days in the financial year.
 *
 * Which financial year a slip belongs to is the year its pay landed in, not the
 * year the work fell in — see {@link payslipAttributionDate}. The year reaches
 * this module as a caller-supplied label on {@link PayslipActuals}, and enters the
 * math only as the day count an off-cadence period is apportioned over, so a
 * period straddling 30 June still counts every one of its own days.
 */

import type { Frequency, Money } from './index'
import { annualCents, MONTHS_PER_YEAR, periodsPerYear, WEEKS_PER_YEAR } from './normalize'

/** Milliseconds in a day, for inclusive calendar-day arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Days in a week: a week-based cadence's period is exactly this many days long. */
const DAYS_PER_WEEK = 7

/** The shortest calendar month, the lower bound of a month-based cadence's period. */
const MIN_DAYS_PER_MONTH = 28

/** The longest calendar month, the upper bound of a month-based cadence's period. */
const MAX_DAYS_PER_MONTH = 31

/** Parses an ISO date (`YYYY-MM-DD`) as a UTC midnight, matching the FY bounds. */
function isoDateMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

/** The inclusive count of calendar days between two UTC-midnight instants, floored at zero. */
function inclusiveDayCount(startMs: number, endMs: number): number {
  return Math.max(0, Math.round((endMs - startMs) / MS_PER_DAY) + 1)
}

/** Whether a nullable stored value — a figure or an effective date — was entered. */
function isEntered<T>(value: T | null | undefined): value is T {
  return value != null
}

/** One pay period, both ISO dates (`YYYY-MM-DD`) inclusive. */
export interface PayPeriod {
  readonly periodStart: string
  readonly periodEnd: string
}

/** The dates a payslip is attributed by, both ISO (`YYYY-MM-DD`). */
export interface PayslipAttribution {
  /** The date the pay landed; absent or null on a slip that states none. */
  readonly paidOn?: string | null
  /** The pay period's last day, which every slip carries. */
  readonly periodEnd: string
}

/**
 * The date a payslip is attributed to: the date the pay landed, or the pay
 * period's last day for a slip that states none. Salary and wages are assessed in
 * the year the money is **paid** rather than the year the work that earned it
 * fell in, so this is the date that decides which financial year a slip is filed
 * under — a fortnight worked to 28 June and paid 1 July belongs to the later year
 * — and which of two slips reports the further-advanced year-to-date totals.
 */
export function payslipAttributionDate({ paidOn, periodEnd }: PayslipAttribution): string {
  return isEntered(paidOn) ? paidOn : periodEnd
}

/**
 * What one payslip line is, and so what it is measured against: an `earning`
 * against the inflow it draws on, or a `tax` line against the component of the
 * estimated liability it pays.
 */
export type PayslipLineKind = 'earning' | 'tax'

/**
 * Which part of the estimated liability a tax line pays: `stsl` the compulsory
 * HELP/HECS repayment, `payg` the income tax and levies that are the rest of it.
 */
export type PayslipTaxComponent = 'payg' | 'stsl'

/**
 * One earnings line a payslip itemises: an amount under the label the slip
 * prints, and the projected inflow it draws on. Several lines may name the same
 * inflow — ordinary hours and annual leave both draw on the salary — and a line
 * naming none (`sourceInflowId` null) has no projection to be measured against.
 */
export interface PayslipEarningLine {
  readonly kind: 'earning'
  readonly sourceInflowId: string | null
  readonly label: string
  readonly amountCents: Money
  /**
   * Whether the line is ordinary time earnings, taken from the inflow it draws
   * on when the line was written. Absent reads as true, so only a line recorded
   * as an allowance — on-call, taxed in full but earning no super — is left out
   * of the super base. The decision is the line's own rather than its inflow's:
   * a payslip is a historical record, so retiring or reclassifying the inflow
   * cannot move the super an entered slip is measured against.
   */
  readonly attractsSuper?: boolean
}

/**
 * One tax line a payslip itemises: an amount under the label the slip prints,
 * and the part of the estimated liability it pays. A slip's TAX section prints
 * PAYG income tax and an STSL study-loan component beneath one total, and the two
 * pay different parts of the same liability, so each is held against its own —
 * `stsl` against the compulsory HELP repayment and `payg` against everything
 * else. A line has no inflow to draw on: tax is withheld from earnings, not
 * earned.
 */
export interface PayslipTaxLine {
  readonly kind: 'tax'
  readonly component: PayslipTaxComponent
  readonly label: string
  readonly amountCents: Money
}

/** One line on a payslip, discriminated by what the slip prints it as. */
export type PayslipLine = PayslipEarningLine | PayslipTaxLine

/**
 * The actual figures one payslip reports. `superCents` is the employer super
 * guarantee and `salarySacrificeCents` the concessional sacrifice shown
 * separately; together they are the slip's total concessional super.
 */
export interface PayslipActuals extends PayPeriod {
  /**
   * The AU financial year the slip's pay landed in, labelled by its ending year
   * (FY2027 = 1 Jul 2026 – 30 Jun 2027) — see {@link payslipAttributionDate}.
   */
  readonly financialYear: number
  readonly grossCents: Money
  /**
   * The slip's printed tax total: PAYG income tax plus any STSL study-loan
   * withholding, never the PAYG line alone. The annual liability it is measured
   * against includes the compulsory HELP repayment the STSL pays.
   */
  readonly taxWithheldCents: Money
  readonly superCents: Money
  readonly salarySacrificeCents?: Money | null
  /**
   * The slip's lines, earnings and tax alike, where it is itemised. Absent or
   * empty leaves the slip one undifferentiated gross with no projection to be
   * measured against and no pay cycle to read, and its whole tax total held
   * against the whole liability. The lines need not sum to the printed totals;
   * what is left over is reported as `unallocatedCents` and
   * `unallocatedTaxCents`.
   */
  readonly lines?: readonly PayslipLine[]
}

/**
 * The projected taxable inflow a payslip's earnings lines draw on. A `wage`
 * inflow's per-period gross is `hourlyRateCents × hoursPerPeriod`; `salary` and
 * `other` carry it in `amountCents`. `startsOn`/`endsOn` are the inflow's
 * effective dates, which clip the share of the pay period it is active for.
 * Structurally satisfied by `@nest/tax`'s `IncomeInput`, so a caller passes the
 * same object it feeds the tax estimate.
 */
export interface ReconciledInflow {
  readonly type: 'salary' | 'wage' | 'other'
  readonly schedule: Frequency
  readonly amountCents?: Money
  readonly hourlyRateCents?: Money
  readonly hoursPerPeriod?: number
  /** The interval N for the `every_n_weeks`/`every_n_months` cadences. */
  readonly interval?: number
  readonly startsOn?: string | null
  readonly endsOn?: string | null
  /**
   * Whether the inflow is ordinary time earnings, which the employer super
   * guarantee accrues on. Absent reads as true, so only an inflow marked
   * otherwise — an allowance such as on-call, taxed in full but earning no super
   * — is left out of the super base. A slip's own super base reads each line's
   * recorded decision rather than this one, which a line snapshots when it is
   * written.
   */
  readonly attractsSuper?: boolean
}

/**
 * The versioned per-financial-year super parameters an expectation reads.
 * Structurally satisfied by `@nest/tax`'s `TaxYearConfig['super']`, so a caller
 * passes `config.super` straight in and the guarantee rate is always the year's
 * published figure rather than a literal.
 */
export interface SuperGuaranteeConfig {
  /** Employer super guarantee rate, on ordinary time earnings. */
  readonly guaranteeRate: number
}

/** What the plan expected of the member the payslip belongs to, for its financial year. */
export interface PayslipExpectation {
  /**
   * Every inflow a line may draw on, keyed by id — the projections the per-inflow
   * groups are measured against, and the pay cycle a slip's own expectations are
   * divided by. A line naming an inflow that is absent here is grouped with no
   * expectation, exactly as an unmapped line is.
   */
  readonly inflowsById?: ReadonlyMap<string, ReconciledInflow>
  /**
   * The member's whole annual estimated liability —
   * `MemberTaxEstimate.annualTaxCents`, which is
   * `TaxBreakdown.totalLiabilityCents`. HELP repayment included, so it is what
   * the slip's printed tax total is measured against.
   */
  readonly annualTaxCents: Money
  /**
   * The member's annual compulsory HELP/HECS repayment —
   * `TaxBreakdown.helpRepaymentCents`, the part of `annualTaxCents` an STSL line
   * pays. An `stsl` tax line is measured against it and a `payg` line against
   * what is left; absent is nil, which holds a PAYG line against the whole
   * liability, correct for a member with no study loan.
   */
  readonly annualHelpRepaymentCents?: Money
  /** The member's annual concessional super contributions; absent is nil. */
  readonly annualConcessionalContributionsCents?: Money
  readonly superConfig: SuperGuaranteeConfig
}

/**
 * Which basis an expected figure was computed on: `cadence` divides the annual
 * figure by the inflow cadence's periods per year, `calendar_days` apportions it
 * by the period's share of the financial year.
 */
export type ExpectationBasis = 'cadence' | 'calendar_days'

/**
 * One inflow's share of an itemised payslip: the lines drawing on it summed and
 * measured against that inflow's projection for the period. `sourceInflowId` is
 * null for the lines mapped to no inflow, which — like a line naming an inflow
 * the expectation does not carry — have no projection to compare and so report a
 * null expectation and variance.
 */
export interface PayslipLineGroupVariance {
  readonly sourceInflowId: string | null
  /** The labels of the group's lines, in the order the slip gave them. */
  readonly labels: readonly string[]
  /** The group's lines summed — what the slip actually paid against this inflow. */
  readonly actualCents: Money
  readonly expectedCents: Money | null
  readonly varianceCents: Money | null
  /** Which basis `expectedCents` was computed on; `calendar_days` with no inflow. */
  readonly basis: ExpectationBasis
}

/**
 * One component's share of a slip's tax: the lines paying it summed and measured
 * against the part of the estimated liability they pay. `stsl` is held against the
 * compulsory HELP repayment and `payg` against the liability less that repayment,
 * so a study-loan component that is short cannot hide behind income tax that is
 * over. Both figures are on the slip's own {@link PayslipVariance.basis}, since
 * the same pay cycle withholds both.
 */
export interface PayslipTaxGroupVariance {
  readonly component: PayslipTaxComponent
  /** The labels of the group's lines, in the order the slip gave them. */
  readonly labels: readonly string[]
  /** The group's lines summed — what the slip actually withheld for this component. */
  readonly actualCents: Money
  readonly expectedCents: Money
  readonly varianceCents: Money
}

/**
 * One payslip measured against the plan: each expected figure alongside its
 * variance (actual − expected), positive when the payslip reported more than the
 * plan projected. Gross is null when nothing on the slip maps to a projection.
 */
export interface PayslipVariance {
  /**
   * Which basis the withholding and concessional-super expectations were
   * computed on, read from the pay cycle the slip's lines are drawn on. Each
   * earnings-line group reports its own basis, since a group's inflow may run on
   * another cadence.
   */
  readonly basis: ExpectationBasis
  /**
   * The inflow whose pay cycle `basis` was read from — the slip's largest
   * earnings group — or null when no earnings line resolves to a projection,
   * which leaves the slip no cycle to read.
   */
  readonly cadenceInflowId: string | null
  /** Inclusive calendar days in the pay period. */
  readonly periodDays: number
  /** Inclusive calendar days in the financial year — 365, or 366 in a leap year. */
  readonly financialYearDays: number
  /** `periodDays / financialYearDays`, the share of the year the period covers. */
  readonly periodFraction: number
  readonly expectedGrossCents: Money | null
  readonly grossVarianceCents: Money | null
  /**
   * The slip's earnings lines grouped by the inflow they draw on, each summed and
   * measured against that inflow's projection, in the order the inflows first
   * appear on the slip. Empty for a slip carrying no earnings lines.
   */
  readonly lineGroups: readonly PayslipLineGroupVariance[]
  /**
   * The slip's gross less every earnings line on it — earnings the itemisation
   * does not account for. Nil for a slip carrying no earnings lines, and negative
   * where the lines overshoot the gross.
   */
  readonly unallocatedCents: Money
  readonly expectedTaxWithheldCents: Money
  readonly taxWithheldVarianceCents: Money
  /**
   * The slip's tax lines grouped by the component they pay, each summed and
   * measured against that component of the estimated liability, in the order the
   * components first appear on the slip. Empty for a slip carrying no tax lines.
   */
  readonly taxGroups: readonly PayslipTaxGroupVariance[]
  /**
   * The slip's printed tax total less every tax line on it — withholding the
   * itemisation does not account for. Nil for a slip carrying no tax lines, and
   * negative where the lines overshoot the total.
   */
  readonly unallocatedTaxCents: Money
  /**
   * The gross the expected super guarantee is charged on: the slip's gross less
   * every earnings line recorded as earning no super. The slip's whole gross
   * where nothing on it is non-OTE — including a slip carrying no lines, which
   * says nothing to the contrary — and never below nil, since lines overshooting
   * the gross are a typing mistake rather than negative super.
   */
  readonly superBaseCents: Money
  /** The employer guarantee component of the expected super. */
  readonly expectedSuperGuaranteeCents: Money
  /** The concessional-contribution component of the expected super. */
  readonly expectedConcessionalCents: Money
  readonly expectedSuperCents: Money
  /** The payslip's employer super plus its salary sacrifice. */
  readonly actualSuperCents: Money
  readonly superVarianceCents: Money
}

/**
 * A payslip's stored figures, as an aggregation reads them, carrying the dates
 * that rank it against the household's other slips.
 */
export interface PayslipTotalsRow extends PayslipAttribution {
  readonly memberId: string
  readonly grossCents: Money
  readonly taxWithheldCents: Money
  readonly superCents: Money
  readonly salarySacrificeCents?: Money | null
  readonly ytdGrossCents?: Money | null
  readonly ytdTaxWithheldCents?: Money | null
  readonly ytdSuperCents?: Money | null
}

/** Actuals summed from payslip rows, with the number of rows they came from. */
export interface PayslipTotals {
  readonly grossCents: Money
  readonly taxWithheldCents: Money
  readonly superCents: Money
  readonly salarySacrificeCents: Money
  readonly payslipCount: number
}

/** The running totals a single payslip reports. */
export interface PayslipYearToDateTotals {
  readonly grossCents: Money
  readonly taxWithheldCents: Money
  readonly superCents: Money
}

/** The inclusive day count a period on one cadence occupies, as a range. */
interface CadenceDayRange {
  readonly minDays: number
  readonly maxDays: number
}

/**
 * The inclusive calendar-day count of an AU financial year, labelled by its
 * ending year: 1 July of the year before the label through 30 June of the label
 * year, so 365 days or 366 when the label year is a leap year.
 */
export function financialYearDayCount(financialYear: number): number {
  return inclusiveDayCount(Date.UTC(financialYear - 1, 6, 1), Date.UTC(financialYear, 5, 30))
}

/** The inclusive calendar days a pay period spans; nil for a period ending before it starts. */
function periodDayCount(period: PayPeriod): number {
  return inclusiveDayCount(isoDateMs(period.periodStart), isoDateMs(period.periodEnd))
}

/**
 * The share of the financial year a pay period covers: its inclusive calendar-day
 * count over the financial year's. A pay period straddling 30 June counts all of
 * its own days — the period is not clipped to the year it is filed under, which is
 * the year its pay landed in, so a fortnight worked to 28 June and paid 1 July is
 * measured whole against the later year. The year supplies only the denominator,
 * 365 days or 366, so filing such a period by its payment date rather than its own
 * last day moves the fraction by at most a leap day. An inverted period (ending
 * before it starts) covers nothing.
 */
export function periodFractionOfFinancialYear(period: PayPeriod, financialYear: number): number {
  return periodDayCount(period) / financialYearDayCount(financialYear)
}

/**
 * Prorates an annual cent figure to a pay period, to whole cents: the annual
 * amount times the period's share of the financial year. This is the same
 * calendar-day counting the FY tax estimate applies to a dated inflow's
 * effective window, and is the basis for every period that does not match its
 * inflow's cadence.
 */
export function prorateAnnualToPeriod(
  annualAmountCents: Money,
  period: PayPeriod,
  financialYear: number,
): Money {
  return Math.round(annualAmountCents * periodFractionOfFinancialYear(period, financialYear))
}

/** The exact day count of a period spanning `weeksPerPeriod` whole weeks. */
function weekRange(weeksPerPeriod: number): CadenceDayRange {
  const days = Math.round(DAYS_PER_WEEK * weeksPerPeriod)
  return { minDays: days, maxDays: days }
}

/** The day range of a period spanning `monthsPerPeriod` whole calendar months. */
function monthRange(monthsPerPeriod: number): CadenceDayRange {
  const months = Math.round(monthsPerPeriod)
  return { minDays: MIN_DAYS_PER_MONTH * months, maxDays: MAX_DAYS_PER_MONTH * months }
}

/**
 * The inclusive day count a single period on `frequency` occupies. A week-based
 * cadence is exact — a week is always seven days — while a month-based cadence
 * spans anything from the shortest to the longest calendar month per month in the
 * period, so a monthly period is 28 to 31 days. Null for an
 * `every_n_weeks`/`every_n_months` cadence with no usable interval, which has no
 * nominal period length at all.
 */
function cadenceDayRange(frequency: Frequency, interval?: number): CadenceDayRange | null {
  const periods = periodsPerYear(frequency, interval)
  if (periods === 0) {
    return null
  }
  switch (frequency) {
    case 'weekly':
      return weekRange(1)
    case 'fortnightly':
      return weekRange(2)
    case 'every_n_weeks':
      return weekRange(WEEKS_PER_YEAR / periods)
    case 'monthly':
      return monthRange(1)
    case 'quarterly':
      return monthRange(3)
    case 'biannual':
      return monthRange(6)
    case 'annual':
      return monthRange(12)
    case 'every_n_months':
      return monthRange(MONTHS_PER_YEAR / periods)
  }
}

/** The inclusive days of `period` the inflow's effective window covers. */
function activeDaysInPeriod(inflow: ReconciledInflow, period: PayPeriod): number {
  const periodStartMs = isoDateMs(period.periodStart)
  const periodEndMs = isoDateMs(period.periodEnd)
  const windowStartMs = isEntered(inflow.startsOn) ? isoDateMs(inflow.startsOn) : periodStartMs
  const windowEndMs = isEntered(inflow.endsOn) ? isoDateMs(inflow.endsOn) : periodEndMs
  return inclusiveDayCount(
    Math.max(periodStartMs, windowStartMs),
    Math.min(periodEndMs, windowEndMs),
  )
}

/**
 * Whether a pay period is one whole turn of the inflow's cadence, and so
 * measurable against the annual figure divided by periods per year rather than
 * apportioned by calendar days. It is when the period's day count is the
 * cadence's nominal length — exactly seven days a week for a week-based cadence,
 * and 28 to 31 days a month for a month-based one, since a calendar month varies
 * — and the inflow is effective for every day of it. A period the inflow's
 * effective dates clip is a part period however well its length fits, as is one
 * on a cadence with no usable interval.
 */
export function isPeriodOnCadence(inflow: ReconciledInflow, period: PayPeriod): boolean {
  const range = cadenceDayRange(inflow.schedule, inflow.interval)
  if (range === null) {
    return false
  }
  const days = periodDayCount(period)
  return (
    activeDaysInPeriod(inflow, period) === days && days >= range.minDays && days <= range.maxDays
  )
}

/**
 * Annualises an inflow's steady per-period gross to whole cents. The per-period
 * gross is `hourlyRateCents × hoursPerPeriod` rounded to whole cents for a
 * `wage` and `amountCents` for a `salary` or `other`, with missing figures taken
 * as zero; the schedule's cadence is normalised by `annualCents`, so an
 * `every_n_weeks`/`every_n_months` inflow with no usable interval annualises to
 * zero. The inflow's effective dates are not applied here — this is the
 * full-year rate a period's expectation is drawn from.
 */
export function annualInflowGrossCents(inflow: ReconciledInflow): Money {
  const perPeriodCents =
    inflow.type === 'wage'
      ? Math.round((inflow.hourlyRateCents ?? 0) * (inflow.hoursPerPeriod ?? 0))
      : (inflow.amountCents ?? 0)
  return annualCents(perPeriodCents, inflow.schedule, inflow.interval)
}

/**
 * The gross the plan projects for one pay period. A period on the inflow's
 * cadence gets the annualised gross divided by the cadence's periods per year,
 * rounded to the nearest cent — the steady amount the employer pays each period.
 * Any other period gets the annualised gross apportioned by the days of it the
 * inflow is effective for, over the days in the financial year: a window that
 * covers none of the period projects nothing, and a mid-period pay rise modelled
 * as one dated inflow ending and another starting has the two part-period
 * expectations sum to the whole period's calendar-day share.
 */
export function expectedPeriodGrossCents(
  inflow: ReconciledInflow,
  period: PayPeriod,
  financialYear: number,
): Money {
  const annualGrossCents = annualInflowGrossCents(inflow)
  // A cadence with no usable interval is never on-cadence, so periods per year is
  // never the zero it returns for one.
  if (isPeriodOnCadence(inflow, period)) {
    return Math.round(annualGrossCents / periodsPerYear(inflow.schedule, inflow.interval))
  }
  return Math.round(
    (annualGrossCents * activeDaysInPeriod(inflow, period)) / financialYearDayCount(financialYear),
  )
}

/** The projection a line draws on, or undefined for one mapped to none the expectation carries. */
function inflowForLine(
  sourceInflowId: string | null,
  inflowsById: ReadonlyMap<string, ReconciledInflow> | undefined,
): ReconciledInflow | undefined {
  return sourceInflowId === null ? undefined : inflowsById?.get(sourceInflowId)
}

/** Whether the line is an earning, measured against the inflow it draws on. */
function isEarningLine(line: PayslipLine): line is PayslipEarningLine {
  return line.kind === 'earning'
}

/** Whether the line is tax withheld, measured against the component it pays. */
function isTaxLine(line: PayslipLine): line is PayslipTaxLine {
  return line.kind === 'tax'
}

/**
 * Groups a slip's earnings lines by the inflow they draw on — preserving the
 * order the inflows first appear — and measures each group's sum against that
 * inflow's expectation for the period, on the same cadence-or-calendar-days basis
 * a whole slip is measured on. A group whose inflow is unknown reports a null
 * expectation: there is nothing to compare its lines to.
 */
function lineGroupVariances(
  lines: readonly PayslipEarningLine[],
  expectation: PayslipExpectation,
  period: PayPeriod,
  financialYear: number,
): readonly PayslipLineGroupVariance[] {
  const grouped = new Map<string | null, { labels: string[]; actualCents: Money }>()
  for (const line of lines) {
    const group = grouped.get(line.sourceInflowId)
    if (group === undefined) {
      grouped.set(line.sourceInflowId, { labels: [line.label], actualCents: line.amountCents })
    } else {
      group.labels.push(line.label)
      group.actualCents += line.amountCents
    }
  }
  return [...grouped].map(([sourceInflowId, group]) => {
    const inflow = inflowForLine(sourceInflowId, expectation.inflowsById)
    const expectedCents =
      inflow === undefined ? null : expectedPeriodGrossCents(inflow, period, financialYear)
    return {
      sourceInflowId,
      labels: group.labels,
      actualCents: group.actualCents,
      expectedCents,
      varianceCents: expectedCents === null ? null : group.actualCents - expectedCents,
      basis:
        inflow !== undefined && isPeriodOnCadence(inflow, period)
          ? ('cadence' as const)
          : ('calendar_days' as const),
    }
  })
}

/**
 * The inflow whose pay cycle a slip's own expectations are divided by: the one
 * its largest earnings group draws on, or null when no group resolves to a
 * projection the expectation carries.
 *
 * A period's expected withholding and concessional super are annual figures
 * divided by the cycle the employer pays on, and a slip states that cycle only
 * through the projections its earnings draw on. The largest group is the best
 * evidence of it: an employer pays every line of one payment on one cycle, so the
 * earning that makes up most of the payment is the one whose projection is most
 * likely modelled on that cycle. Groups are read in the order the slip printed
 * them and the comparison is strict, so equal groups keep the first.
 *
 * A disagreement among the groups' cadences is deliberately not a reason to fall
 * back to calendar days. An annual bonus paid beside a fortnightly salary is an
 * ordinary slip, and dropping it to a calendar-day apportionment for the sake of
 * the smaller line would move a whole fortnight's expectations off the cadence
 * that really paid it. The pick is self-correcting instead: {@link
 * isPeriodOnCadence} still requires the period to be one whole turn of the chosen
 * cadence with the inflow effective throughout, so a cadence the slip's period
 * does not fit yields the calendar-days proration anyway.
 */
function cadenceInflowFor(
  lineGroups: readonly PayslipLineGroupVariance[],
  inflowsById: ReadonlyMap<string, ReconciledInflow> | undefined,
): { readonly sourceInflowId: string; readonly inflow: ReconciledInflow } | null {
  let largest: {
    readonly sourceInflowId: string
    readonly inflow: ReconciledInflow
    readonly actualCents: Money
  } | null = null
  for (const group of lineGroups) {
    const inflow = inflowForLine(group.sourceInflowId, inflowsById)
    if (group.sourceInflowId === null || inflow === undefined) {
      continue
    }
    if (largest === null || group.actualCents > largest.actualCents) {
      largest = { sourceInflowId: group.sourceInflowId, inflow, actualCents: group.actualCents }
    }
  }
  return largest
}

/**
 * Groups a slip's tax lines by the component they pay — preserving the order the
 * components first appear — and measures each group's sum against the part of the
 * annual liability it pays, prorated to the period by `expectedForComponent`.
 */
function taxGroupVariances(
  lines: readonly PayslipTaxLine[],
  expectedForComponent: (component: PayslipTaxComponent) => Money,
): readonly PayslipTaxGroupVariance[] {
  const grouped = new Map<PayslipTaxComponent, { labels: string[]; actualCents: Money }>()
  for (const line of lines) {
    const group = grouped.get(line.component)
    if (group === undefined) {
      grouped.set(line.component, { labels: [line.label], actualCents: line.amountCents })
    } else {
      group.labels.push(line.label)
      group.actualCents += line.amountCents
    }
  }
  return [...grouped].map(([component, group]) => {
    const expectedCents = expectedForComponent(component)
    return {
      component,
      labels: group.labels,
      actualCents: group.actualCents,
      expectedCents,
      varianceCents: group.actualCents - expectedCents,
    }
  })
}

/**
 * Measures one payslip against the plan. The withholding and concessional-super
 * expectations rest on the one basis reported as `basis`: the cadence when the
 * period is one whole turn of the cycle the slip's lines are drawn on — see
 * {@link cadenceInflowFor} — and calendar days otherwise, including when no line
 * resolves to a projection and there is no cycle to read.
 *
 * Expected gross comes from the slip's earnings lines: each inflow's lines are
 * summed and held against that inflow's projection for the period, and those group
 * expectations sum to the slip's, which is null when nothing on the slip maps to a
 * projection. The gross the lines do not account for is reported as
 * `unallocatedCents` and reads as gross above plan, which is what unexplained
 * earnings are.
 *
 * Tax is measured twice over, against the same estimate. The slip's printed total
 * is held against the whole annual liability for the period — HELP repayment
 * included, since the total carries the STSL that pays it — and each tax line
 * group against the component it pays, `stsl` against the compulsory repayment and
 * `payg` against the liability less that repayment. The two views answer different
 * questions: the total says whether the year is heading for a refund or a bill,
 * and the components say which of the two withholdings is off. The tax the lines
 * do not account for is `unallocatedTaxCents`, exactly as for earnings.
 *
 * Expected super is the versioned guarantee rate on `superBaseCents` — the slip's
 * actual gross less every earnings line recorded as earning no super. An allowance
 * is left out of the base while the guarantee stays a percentage of what was
 * really earned, keeping the super variance a rate check independent of the gross
 * variance. Added to it is the member's annual concessional contributions for the
 * period, and the total is compared against the payslip's employer super plus its
 * salary sacrifice, the matching total concessional figure. Each variance is
 * actual − expected.
 *
 * Every per-period figure is rounded to the nearest cent on its own, halves up.
 * The remainder of an annual figure that does not divide evenly by its periods
 * per year is dropped rather than spread across the year's periods: the
 * expectation is a per-period rate to hold one slip against, not an allocation
 * that has to sum back to the annual figure. That is why the two component
 * expectations may sit a cent either side of the whole-total one.
 */
export function payslipVariance(
  payslip: PayslipActuals,
  expectation: PayslipExpectation,
): PayslipVariance {
  const financialYearDays = financialYearDayCount(payslip.financialYear)
  const periodDays = periodDayCount(payslip)
  const lines = payslip.lines ?? []
  const earningLines = lines.filter(isEarningLine)
  const taxLines = lines.filter(isTaxLine)
  const lineGroups = lineGroupVariances(earningLines, expectation, payslip, payslip.financialYear)
  const cadence = cadenceInflowFor(lineGroups, expectation.inflowsById)
  const cadencePeriodsPerYear =
    cadence !== null && isPeriodOnCadence(cadence.inflow, payslip)
      ? periodsPerYear(cadence.inflow.schedule, cadence.inflow.interval)
      : null
  const expectedForPeriod = (annualAmountCents: Money): Money =>
    cadencePeriodsPerYear === null
      ? prorateAnnualToPeriod(annualAmountCents, payslip, payslip.financialYear)
      : Math.round(annualAmountCents / cadencePeriodsPerYear)
  let expectedGrossCents: Money | null = null
  for (const group of lineGroups) {
    if (group.expectedCents !== null) {
      expectedGrossCents = (expectedGrossCents ?? 0) + group.expectedCents
    }
  }
  const allocatedCents = earningLines.reduce((sum, line) => sum + line.amountCents, 0)
  const nonOteCents = earningLines.reduce(
    (sum, line) => (line.attractsSuper === false ? sum + line.amountCents : sum),
    0,
  )
  const superBaseCents = Math.max(0, payslip.grossCents - nonOteCents)
  const annualHelpRepaymentCents = expectation.annualHelpRepaymentCents ?? 0
  const expectedTaxWithheldCents = expectedForPeriod(expectation.annualTaxCents)
  const expectedSuperGuaranteeCents = Math.round(
    superBaseCents * expectation.superConfig.guaranteeRate,
  )
  const expectedConcessionalCents = expectedForPeriod(
    expectation.annualConcessionalContributionsCents ?? 0,
  )
  const expectedSuperCents = expectedSuperGuaranteeCents + expectedConcessionalCents
  const actualSuperCents = payslip.superCents + (payslip.salarySacrificeCents ?? 0)
  return {
    basis: cadencePeriodsPerYear === null ? 'calendar_days' : 'cadence',
    cadenceInflowId: cadence === null ? null : cadence.sourceInflowId,
    periodDays,
    financialYearDays,
    periodFraction: periodDays / financialYearDays,
    expectedGrossCents,
    grossVarianceCents:
      expectedGrossCents === null ? null : payslip.grossCents - expectedGrossCents,
    lineGroups,
    unallocatedCents: earningLines.length === 0 ? 0 : payslip.grossCents - allocatedCents,
    expectedTaxWithheldCents,
    taxWithheldVarianceCents: payslip.taxWithheldCents - expectedTaxWithheldCents,
    taxGroups: taxGroupVariances(taxLines, (component) =>
      expectedForPeriod(
        component === 'stsl'
          ? annualHelpRepaymentCents
          : expectation.annualTaxCents - annualHelpRepaymentCents,
      ),
    ),
    unallocatedTaxCents:
      taxLines.length === 0
        ? 0
        : payslip.taxWithheldCents - taxLines.reduce((sum, line) => sum + line.amountCents, 0),
    superBaseCents,
    expectedSuperGuaranteeCents,
    expectedConcessionalCents,
    expectedSuperCents,
    actualSuperCents,
    superVarianceCents: actualSuperCents - expectedSuperCents,
  }
}

/**
 * Sums payslip rows into their actual totals — the source of truth for a
 * member's year-to-date figures. Pass one member's rows for one financial year;
 * a row's absent salary sacrifice counts as nil.
 */
export function payslipYearToDate(payslips: readonly PayslipTotalsRow[]): PayslipTotals {
  return payslips.reduce<PayslipTotals>(
    (totals, payslip) => ({
      grossCents: totals.grossCents + payslip.grossCents,
      taxWithheldCents: totals.taxWithheldCents + payslip.taxWithheldCents,
      superCents: totals.superCents + payslip.superCents,
      salarySacrificeCents: totals.salarySacrificeCents + (payslip.salarySacrificeCents ?? 0),
      payslipCount: totals.payslipCount + 1,
    }),
    { grossCents: 0, taxWithheldCents: 0, superCents: 0, salarySacrificeCents: 0, payslipCount: 0 },
  )
}

/**
 * Groups payslip rows by member and sums each member's actual totals. Pass one
 * financial year's rows; a member with no rows is absent from the map.
 */
export function payslipYearToDateByMember(
  payslips: readonly PayslipTotalsRow[],
): ReadonlyMap<string, PayslipTotals> {
  const rowsByMember = new Map<string, PayslipTotalsRow[]>()
  for (const payslip of payslips) {
    const rows = rowsByMember.get(payslip.memberId)
    if (rows) {
      rows.push(payslip)
    } else {
      rowsByMember.set(payslip.memberId, [payslip])
    }
  }
  return new Map(
    [...rowsByMember].map(([memberId, rows]) => [memberId, payslipYearToDate(rows)] as const),
  )
}

/**
 * Each member's summed actual tax withheld — every slip's printed tax total, PAYG
 * plus any STSL — keyed by member id. This is the map `estimateHouseholdTax` takes
 * as its per-member withholding, turning the estimate's liability into a refund or
 * amount owing. Pass one financial year's rows; a member with no payslips is
 * absent, so their estimate keeps its nil withholding.
 *
 * The printed total is what it sums, never a slip's `payg` lines: the liability it
 * is netted against includes the compulsory HELP repayment the STSL pays, so
 * counting the PAYG component alone would overstate the amount owing by every
 * dollar of STSL withheld. Itemising a slip's tax splits how the variance is
 * *reported*, per component; the year's withholding is still the whole of it.
 */
export function paygWithheldByMember(
  payslips: readonly PayslipTotalsRow[],
): ReadonlyMap<string, Money> {
  return new Map(
    [...payslipYearToDateByMember(payslips)].map(
      ([memberId, totals]) => [memberId, totals.taxWithheldCents] as const,
    ),
  )
}

/**
 * The running totals reported by the latest payslip that carries all three — an
 * anchor for a financial year whose earlier slips were never entered, since a
 * slip's own year-to-date figures already account for them. Null when no row
 * reports a complete set.
 *
 * Rows are ranked by {@link payslipAttributionDate}, not by pay period: the
 * running totals printed on a slip are the employer's own totals as at that
 * payment, so a back-pay slip covering an old period but paid most recently
 * reports the further-advanced figures even though its period ended first.
 */
export function latestReportedYearToDate(
  payslips: readonly PayslipTotalsRow[],
): PayslipYearToDateTotals | null {
  let latest: {
    readonly attributedOn: string
    readonly totals: PayslipYearToDateTotals
  } | null = null
  for (const payslip of payslips) {
    const { ytdGrossCents, ytdTaxWithheldCents, ytdSuperCents } = payslip
    if (!isEntered(ytdGrossCents) || !isEntered(ytdTaxWithheldCents) || !isEntered(ytdSuperCents)) {
      continue
    }
    const attributedOn = payslipAttributionDate(payslip)
    if (latest !== null && attributedOn <= latest.attributedOn) {
      continue
    }
    latest = {
      attributedOn,
      totals: {
        grossCents: ytdGrossCents,
        taxWithheldCents: ytdTaxWithheldCents,
        superCents: ytdSuperCents,
      },
    }
  }
  return latest === null ? null : latest.totals
}
