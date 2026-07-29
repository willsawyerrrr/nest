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
 * Expected figures rest on one of the bases {@link ExpectationBasis} names, each
 * scaling an annual figure by the unit it is really paid in. A pay period that is
 * one whole turn of the pay cycle the slip's lines are drawn on — the ordinary case
 * — divides the annual figure by the cadence's periods per year, the way an employer
 * pays it, so a slip that matches the projection shows nil variance. A part turn of
 * that cycle takes the same per-period amount and scales it by the days being
 * measured over the days one whole turn spans: a fortnightly wage is paid 26 times a
 * year, not the 26.07 a calendar-day share of the year implies, so a whole turn
 * yields the per-period amount exactly whichever way it is reached and half a turn
 * yields half of it. Only a slip with no pay cycle to read at all — nothing on it
 * names a projection, or the cadence it names states no interval — apportions by
 * inclusive calendar days in the period over inclusive calendar days in the financial
 * year, there being no period unit to scale.
 *
 * That middle basis is reached two materially different ways, told apart by
 * {@link PartCycleReason}: the pay period is not a whole turn of the cycle, or it
 * is one and the dated inflow behind it covers only part of it. The arithmetic is
 * the same either way; what differs is what a reader should make of the figure,
 * since the second is an exact share whose siblings sum back to a whole period.
 *
 * An inflow that arrives only in SOME pay periods is measured on none of them. It
 * has no per-period figure to hold a slip against, so its group reports no
 * expectation and no variance, the slip's gross expectation goes null rather than
 * quietly treating that group as expecting nothing, and the reading that answers
 * "am I getting the on-call I projected?" is the year's —
 * {@link occasionalInflowPositions}.
 *
 * Which financial year a slip belongs to is the year its pay landed in, not the
 * year the work fell in — see {@link payslipAttributionDate}. The year reaches
 * this module as a caller-supplied label on {@link PayslipActuals}, and enters the
 * math only as the denominator that last basis apportions over: a period
 * straddling 30 June counts every one of its own days, and a slip whose pay cycle
 * is known reads the same whichever year it is filed under.
 */

import type { Money } from './index'
import {
  activeDaysInPeriod,
  annualInflowGrossCents,
  arrivesOnlySomePayPeriods,
  expectedPeriodGrossCents,
  isEntered,
  isPeriodOnCadence,
  payCadencePeriodsPerYear,
  payCycleUnit,
  readBasis,
  type ExpectationBasis,
  type PartCycleReason,
  type ReconciledInflow,
} from './payCadence'
import {
  financialYearDayCount,
  financialYearPeriod,
  financialYearUnit,
  periodDayCount,
  prorateAnnualAcrossUnit,
  type PayPeriod,
} from './payPeriod'

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
 * One inflow's share of an itemised payslip: the lines drawing on it summed and
 * measured against that inflow's projection for the period. `sourceInflowId` is
 * null for the lines mapped to no inflow, which — like a line naming an inflow
 * the expectation does not carry — have no projection to compare and so report a
 * null expectation and variance. A group whose inflow arrives only in some pay
 * periods reports the same pair of nulls for a different reason, told apart by its
 * `occasional` basis: the projection exists, and it is annual rather than
 * per-period.
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
  /** Which of the two things put the group on `part_cycle`; null on every other basis. */
  readonly partCycleReason: PartCycleReason | null
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
   * Which basis the withholding and concessional-super expectations were computed
   * on, read from the pay cycle the slip's lines are drawn on. Each earnings-line
   * group reports its own basis, since a group's inflow may run on another cadence.
   */
  readonly basis: ExpectationBasis
  /**
   * Which of the two things put those expectations on `part_cycle`, read from the
   * same cycle and the same inflow's effective dates as `basis`; null on every
   * other basis. A group whose own inflow is dated differently reports its own
   * reason, so this speaks only for the slip's own figures.
   */
  readonly partCycleReason: PartCycleReason | null
  /**
   * The inflow whose pay cycle `basis` was read from — the slip's largest
   * measurable earnings group — or null when no earnings line resolves to a
   * projection that arrives every period, which leaves the slip no cycle to read.
   */
  readonly cadenceInflowId: string | null
  /** Inclusive calendar days in the pay period. */
  readonly periodDays: number
  /**
   * Inclusive calendar days in one whole turn of the pay cycle `basis` was read
   * from — the denominator a part period's expectations are scaled over. Null
   * where no cycle is known, which is what leaves the financial year the only unit
   * to apportion over.
   */
  readonly cadencePeriodDays: number | null
  /**
   * Inclusive calendar days in the financial year — 365, or 366 in a leap year.
   * The denominator only where no pay cycle is known; a slip whose cycle is known
   * is scaled over `cadencePeriodDays` and so reads the same in either year.
   */
  readonly financialYearDays: number
  readonly expectedGrossCents: Money | null
  readonly grossVarianceCents: Money | null
  /**
   * Whether part of the slip's gross is pay no per-period figure covers — earnings
   * drawing on an inflow that arrives only in some pay periods. True is what makes
   * `expectedGrossCents` null even where the slip's other groups do have
   * expectations: summing only those would hold the slip's WHOLE gross against part
   * of it, reading an ordinary on-call fortnight as above plan by the whole
   * allowance. The groups that are measurable still carry their own variances, so
   * nothing is lost — only the total stops claiming to be one.
   */
  readonly grossPartlyUnmeasured: boolean
  /**
   * The occasional groups' lines summed — how much of the gross is the pay
   * `grossPartlyUnmeasured` is about. Nil where nothing on the slip is occasional.
   */
  readonly unmeasuredGrossCents: Money
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
 * inflow's expectation for the period, on the same basis a whole slip is measured
 * on. A group whose inflow is unknown reports a null expectation: there is nothing
 * to compare its lines to. So does one whose inflow arrives only in some pay
 * periods, this period being no more expected to carry it than any other.
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
      ...readBasis(inflow, period),
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
 * A disagreement among the groups' cadences is deliberately not a reason to drop
 * off the cadence basis. An annual bonus paid beside a fortnightly salary is an
 * ordinary slip, and apportioning it for the sake of the smaller line would move a
 * whole fortnight's expectations off the cadence that really paid it. The pick is
 * self-correcting instead: {@link isPeriodOnCadence} still requires the period to
 * be one whole turn of the chosen cadence with the inflow effective throughout, so
 * a cadence the slip's period does not fit scales across that cadence's own turn
 * anyway.
 *
 * An inflow arriving only in some pay periods is **never** the anchor, however
 * large its group. Its cadence says which turns the money *could* land on, not how
 * many times a year it does, so dividing an annual figure by that cadence's periods
 * per year would be dividing by a count the inflow does not keep. It also rides
 * someone else's payrun: on-call is paid alongside the fortnightly salary, so the
 * cycle the employer really withholds on is the steady inflow's — which is what the
 * pick lands on when the allowance is skipped, even on a slip the allowance
 * dominates. A slip whose every group is occasional falls back to the calendar-day
 * basis, exactly as one naming no projection at all does.
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
    if (
      group.sourceInflowId === null ||
      inflow === undefined ||
      arrivesOnlySomePayPeriods(inflow)
    ) {
      continue
    }
    if (largest === null || group.actualCents > largest.actualCents) {
      largest = { sourceInflowId: group.sourceInflowId, inflow, actualCents: group.actualCents }
    }
  }
  return largest
}

/** The gross a slip's earnings groups expect, and the part of it nothing expects. */
interface GrossExpectation {
  readonly expectedGrossCents: Money | null
  readonly grossPartlyUnmeasured: boolean
  readonly unmeasuredGrossCents: Money
}

/**
 * Sums a slip's group expectations into the slip's own, and separates out the pay no
 * per-period figure covers. An occasional group forfeits the total rather than
 * counting as nil: the gross it is subtracted from is the slip's whole gross, so
 * treating the group as expecting nothing would report the allowance it paid as
 * gross above plan. A group with no resolvable inflow is a different case and is
 * still skipped — its earnings really are unexplained, which is what a gross above
 * plan says.
 */
function grossExpectation(lineGroups: readonly PayslipLineGroupVariance[]): GrossExpectation {
  let expectedGrossCents: Money | null = null
  let grossPartlyUnmeasured = false
  let unmeasuredGrossCents = 0
  for (const group of lineGroups) {
    if (group.basis === 'occasional') {
      grossPartlyUnmeasured = true
      unmeasuredGrossCents += group.actualCents
    } else if (group.expectedCents !== null) {
      expectedGrossCents = (expectedGrossCents ?? 0) + group.expectedCents
    }
  }
  return {
    expectedGrossCents: grossPartlyUnmeasured ? null : expectedGrossCents,
    grossPartlyUnmeasured,
    unmeasuredGrossCents,
  }
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
 * {@link cadenceInflowFor} — a part of that cycle's turn when it is not, and
 * calendar days of the financial year only when no line resolves to a projection
 * and there is no cycle to read at all. On that middle basis `partCycleReason` says
 * which case it is: a period that is not a whole turn, or a whole turn the cadence
 * inflow's own effective dates cover only part of.
 *
 * Expected gross comes from the slip's earnings lines: each inflow's lines are
 * summed and held against that inflow's projection for the period, and those group
 * expectations sum to the slip's, which is null when nothing on the slip maps to a
 * projection — or when any of it draws on an inflow arriving only in some pay
 * periods, reported as `grossPartlyUnmeasured` with the amount in
 * `unmeasuredGrossCents`. The gross the lines do not account for is reported as
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
 * The withholding expectation stays the year's liability spread evenly over the pay
 * cycle even on a slip carrying occasional pay, because the liability is one figure
 * over the whole of a member's income and marginal rates make it no sum of
 * per-inflow parts. So a period that happens to carry an on-call allowance withholds
 * more than the smoothed figure and a period without one less, and the year's summed
 * withholding — the figure the refund or bill is worked out from — is unaffected
 * either way.
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
  const cadenceUnit = cadence === null ? null : payCycleUnit(cadence.inflow, payslip)
  const cadencePeriodsPerYear =
    cadence !== null && isPeriodOnCadence(cadence.inflow, payslip)
      ? payCadencePeriodsPerYear(cadence.inflow)
      : null
  const expectedForPeriod = (annualAmountCents: Money): Money =>
    cadencePeriodsPerYear === null
      ? prorateAnnualAcrossUnit(
          annualAmountCents,
          periodDays,
          cadenceUnit ?? financialYearUnit(payslip.financialYear),
        )
      : Math.round(annualAmountCents / cadencePeriodsPerYear)
  const gross = grossExpectation(lineGroups)
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
    ...readBasis(cadence?.inflow, payslip),
    cadenceInflowId: cadence === null ? null : cadence.sourceInflowId,
    periodDays,
    cadencePeriodDays: cadenceUnit === null ? null : cadenceUnit.unitDays,
    financialYearDays,
    expectedGrossCents: gross.expectedGrossCents,
    grossVarianceCents:
      gross.expectedGrossCents === null ? null : payslip.grossCents - gross.expectedGrossCents,
    grossPartlyUnmeasured: gross.grossPartlyUnmeasured,
    unmeasuredGrossCents: gross.unmeasuredGrossCents,
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

/**
 * One payslip as a year's reading of its occasional pay takes it: the dates that
 * rank the slip, and the measurement its own card renders.
 *
 * The measurement rather than the lines, because the occasional groups it carries are
 * already summed there. The figure the year adds up is therefore the very figure the
 * card shows, so the two cannot disagree — the same one-measurement guarantee the
 * year-to-date positions rest on.
 */
export interface OccasionalPositionRow extends PayslipAttribution {
  readonly variance: PayslipVariance
}

/**
 * One occasional inflow's position across a financial year — the reading that
 * answers "am I getting the on-call I projected?", which no single period can.
 *
 * The comparison is against the share of the year already run through rather than
 * the whole year's projection, because half a year of on-call is not short by half
 * the year's allowance. It runs to the member's latest pay rather than to today: the
 * actuals only reach as far as the slips entered, so measuring past them would report
 * every household that has not yet entered this fortnight's slip as behind plan.
 */
export interface OccasionalInflowPosition {
  readonly sourceInflowId: string
  /** Every line drawing on the inflow, across the slips given, summed. */
  readonly actualCents: Money
  /** The inflow's projection for the days of the year run through by `asAt`. */
  readonly expectedCents: Money
  /** `actualCents − expectedCents`, positive where the year is ahead of plan. */
  readonly varianceCents: Money
  /** The inflow's projection for the whole year, its effective dates applied. */
  readonly annualExpectedCents: Money
  /** The date the position runs to: the latest {@link payslipAttributionDate} given. */
  readonly asAt: string
}

/**
 * Each occasional inflow the given payslips draw on, measured across the financial
 * year. Pass one member's measured slips for `financialYear` — the inflows are picked
 * out by what those slips actually name, so a co-member's occasional inflows in the
 * same `inflowsById` map are never reported here. Empty for slips that name none, and
 * for no slips at all.
 *
 * Each inflow's actual is its occasional groups summed straight off the slips'
 * measurements, never their lines re-read, so a row here is the sum of the very
 * figures the cards below it show.
 *
 * Inflows come back in the order their first group appears, matching how a slip's own
 * groups are ordered.
 */
export function occasionalInflowPositions(
  rows: readonly OccasionalPositionRow[],
  inflowsById: ReadonlyMap<string, ReconciledInflow> | undefined,
  financialYear: number,
): readonly OccasionalInflowPosition[] {
  const occasional = new Map<string, { inflow: ReconciledInflow; actualCents: Money }>()
  let asAt = ''
  for (const row of rows) {
    const attributedOn = payslipAttributionDate(row)
    if (attributedOn > asAt) {
      asAt = attributedOn
    }
    for (const group of row.variance.lineGroups) {
      const { sourceInflowId, actualCents } = group
      const inflow = inflowForLine(sourceInflowId, inflowsById)
      if (sourceInflowId === null || inflow === undefined || !arrivesOnlySomePayPeriods(inflow)) {
        continue
      }
      const found = occasional.get(sourceInflowId)
      if (found === undefined) {
        occasional.set(sourceInflowId, { inflow, actualCents })
      } else {
        found.actualCents += actualCents
      }
    }
  }
  const year = financialYearPeriod(financialYear)
  const unit = financialYearUnit(financialYear)
  const toDate = { periodStart: year.periodStart, periodEnd: asAt }
  return [...occasional].map(([sourceInflowId, { inflow, actualCents }]) => {
    const annualGrossCents = annualInflowGrossCents(inflow)
    const expectedCents = prorateAnnualAcrossUnit(
      annualGrossCents,
      activeDaysInPeriod(inflow, toDate),
      unit,
    )
    return {
      sourceInflowId,
      actualCents,
      expectedCents,
      varianceCents: actualCents - expectedCents,
      annualExpectedCents: prorateAnnualAcrossUnit(
        annualGrossCents,
        activeDaysInPeriod(inflow, year),
        unit,
      ),
      asAt,
    }
  })
}
