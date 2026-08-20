/**
 * The pay cadence an inflow's money arrives on, and which basis that puts a pay
 * period's expected figure on. Everything here reasons about a projection and a
 * period; nothing knows what a payslip is.
 *
 * Two frequencies live on an inflow and they answer different questions. `schedule`
 * is the period the amount is EXPRESSED over, which is what annualising divides by
 * and the only one a projection reads. `paySchedule` is the cadence the money
 * ARRIVES on, which is what a pay period is measured against. A third fact sits
 * beside them: whether the money arrives on every turn of that cadence at all —
 * on-call pay rides the fortnightly payrun but only for the fortnights a shift was
 * worked, so `arrivesEveryPayPeriod` false says a period holds no expectation for
 * it rather than the smoothed share a cadence alone would imply.
 *
 * An inflow may instead have no cadence at all. A one-off states the single date its
 * money lands on — severance, a bonus, a gift — so there is nothing to annualise and
 * no turn to measure a period against; its amount is already the whole of it.
 */

import type { Frequency, Money } from './index'
import { annualCents, periodsPerYear } from './normalize'
import {
  cadenceSpan,
  cadenceTurnDays,
  DAYS_PER_WEEK,
  financialYearUnit,
  inclusiveDayCount,
  isoDateMs,
  MAX_DAYS_PER_MONTH,
  MIN_DAYS_PER_MONTH,
  periodDayCount,
  prorateAnnualAcrossUnit,
  type CadenceSpan,
  type PayPeriod,
  type ProrationUnit,
} from './payPeriod'

/** Whether a nullable stored value — a figure or an effective date — was entered. */
export function isEntered<T>(value: T | null | undefined): value is T {
  return value != null
}

/**
 * The projected taxable inflow a payslip's earnings lines draw on. A `wage`
 * inflow's per-period gross is `hourlyRateCents × hoursPerPeriod`; `salary` and
 * `other` carry it in `amountCents`. `startsOn`/`endsOn` are the inflow's
 * effective dates, which clip the share of the pay period it is active for.
 * Structurally satisfied by `@nest/tax`'s `IncomeInput`, so a caller passes the
 * same object it feeds the tax estimate.
 *
 * Two frequencies live here and they answer different questions. `schedule` (with
 * `interval`) is the period the amount is EXPRESSED over — a salary defined as
 * $130,000 a year is `annual`, and that is what annualising divides by.
 * `paySchedule` (with `payInterval`) is the cadence the money ARRIVES on, which is
 * what a pay period is measured against; absent, the two are the same. A one-off
 * carries neither, naming the day its money lands on in `paidOn` instead: nothing
 * about it is annualised or held against a cycle, so its `schedule` is read by no
 * path here and a row that stores none may pass any value.
 */
export interface ReconciledInflow {
  readonly type: 'salary' | 'wage' | 'other'
  /**
   * The period the amount is expressed over. Absent on a one-off, which states the
   * day its money lands on instead; absent on anything else there is no period to
   * multiply the amount up from and no cycle to read, so it annualises to nothing
   * and every period is measured by calendar days.
   */
  readonly schedule?: Frequency
  readonly amountCents?: Money
  readonly hourlyRateCents?: Money
  readonly hoursPerPeriod?: number
  /** The interval N for the `every_n_weeks`/`every_n_months` cadences. */
  readonly interval?: number
  /**
   * The cadence the money arrives on, where it differs from the one the amount is
   * expressed in. Absent or null means they are the same, so an inflow that says
   * nothing here behaves exactly as it always has.
   */
  readonly paySchedule?: Frequency | null
  /** The interval N for an `every_n_weeks`/`every_n_months` pay cadence. */
  readonly payInterval?: number | null
  readonly startsOn?: string | null
  readonly endsOn?: string | null
  /**
   * The single date a one-off's money lands on, and the fact that makes the inflow
   * a one-off at all. Absent or null is a recurring inflow, which is what states a
   * cadence instead. A one-off's amount is the whole payment rather than a figure
   * expressed over a period, so nothing here is annualised and no pay period holds
   * an expectation for it.
   */
  readonly paidOn?: string | null
  /**
   * Whether the money lands on every turn of the pay cadence. Absent reads as
   * true, so only an inflow recorded otherwise — on-call pay, paid on the
   * fortnightly payrun but only for the fortnights a shift was worked — is left
   * without a per-period expectation. It is about WHEN the money lands, never
   * whether it is expected at all: the annual figure is untouched, and so is every
   * projection drawn from it.
   */
  readonly arrivesEveryPayPeriod?: boolean
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
 * Whether the inflow's money lands only in some turns of its pay cadence, which is
 * what leaves a pay period with no expectation to measure it against. The app
 * models per-period payslip totals and no roster, so it cannot know which turns
 * carry the money — and a smoothed per-period figure would report every period as
 * off plan in one direction or the other, neither being a real discrepancy.
 */
export function arrivesOnlySomePayPeriods(inflow: ReconciledInflow): boolean {
  return inflow.arrivesEveryPayPeriod === false
}

/** An inflow whose money lands once, on the day {@link ReconciledInflow.paidOn} names. */
export type OneOffInflow = ReconciledInflow & { readonly paidOn: string }

/**
 * Whether the inflow is a one-off — severance, a bonus, a gift — money that lands
 * on a single day rather than recurring on a cadence. Its amount is the whole
 * payment, so there is nothing to annualise and no turn of a cycle for a pay period
 * to be a share of.
 */
export function isOneOff(inflow: ReconciledInflow): inflow is OneOffInflow {
  return isEntered(inflow.paidOn)
}

/**
 * Whether a pay period holds no expectation for the inflow at all: a one-off, whose
 * money belongs to the day it lands on, or an inflow arriving in only some turns of
 * its cadence. Each has a projection and neither has a per-period one, so measuring
 * either against a period reports pay off plan in whichever direction the payment
 * fell. Both are read across the year instead.
 */
export function isUnmeasuredPerPeriod(inflow: ReconciledInflow): boolean {
  return isOneOff(inflow) || arrivesOnlySomePayPeriods(inflow)
}

/**
 * The cadence the inflow's money arrives on: the pay cadence where it states one,
 * else the cadence its amount is expressed in. Everything about the pay cycle — how
 * long one turn runs, how many turns a year holds, whether a period is one whole
 * turn — reads this, and nothing about annualising an amount does. A $130,000
 * salary expressed annually and paid fortnightly resolves here to `fortnightly`, so
 * a 14-day period is a whole turn worth the annual figure over 26, not part of a
 * 365-day one.
 */
function payCadence(inflow: ReconciledInflow): {
  readonly frequency: Frequency | undefined
  readonly interval: number | undefined
} {
  return isEntered(inflow.paySchedule)
    ? { frequency: inflow.paySchedule, interval: inflow.payInterval ?? undefined }
    : { frequency: inflow.schedule, interval: inflow.interval }
}

/**
 * The inflow's pay cycle resolved: how many turns of it a year holds, and how long
 * one turn nominally runs. Three inflows resolve to no turns and no span, and to the
 * same effect — every figure drawn from them falls to the calendar-day basis and none
 * is ever on cadence: one whose cadence states no usable interval, one stating no
 * cadence at all, and a one-off, which has none to state.
 */
function payCycle(inflow: ReconciledInflow): {
  readonly perYear: number
  readonly span: CadenceSpan | null
} {
  const { frequency, interval } = payCadence(inflow)
  return frequency === undefined
    ? { perYear: 0, span: null }
    : { perYear: periodsPerYear(frequency, interval), span: cadenceSpan(frequency, interval) }
}

/** How many turns of the inflow's pay cadence a year holds — the on-cadence divisor. */
export function payCadencePeriodsPerYear(inflow: ReconciledInflow): number {
  return payCycle(inflow).perYear
}

/**
 * One whole turn of the inflow's pay cycle as a proration unit, measured from the
 * pay period's first day. Null for a cadence with no nominal length, which leaves
 * the caller nothing but the financial year to apportion over.
 */
export function payCycleUnit(inflow: ReconciledInflow, period: PayPeriod): ProrationUnit | null {
  const { perYear, span } = payCycle(inflow)
  return span === null ? null : { perYear, unitDays: cadenceTurnDays(span, period.periodStart) }
}

/** The inclusive days of `period` the inflow's effective window covers. */
export function activeDaysInPeriod(inflow: ReconciledInflow, period: PayPeriod): number {
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
 * Whether a day count is the nominal length of one turn of `span`: exactly seven
 * days a week for a week-based cadence, and 28 to 31 days a month for a month-based
 * one, since a calendar month varies. This is the period's own length alone — what
 * the inflow behind it is effective for is a separate question.
 */
function spansWholeCadenceTurn(span: CadenceSpan, days: number): boolean {
  if (span.unit === 'weeks') {
    return days === Math.round(DAYS_PER_WEEK * span.count)
  }
  const months = Math.round(span.count)
  return days >= MIN_DAYS_PER_MONTH * months && days <= MAX_DAYS_PER_MONTH * months
}

/**
 * Whether a pay period is one whole turn of the inflow's pay cadence, and so
 * measurable against the annual figure divided by periods per year rather than
 * scaled to part of a turn. It is when the period's day count is that cadence's
 * nominal length and the inflow is effective for every day of it. The cadence read
 * is the one the money arrives on, so a fortnight is a whole turn of a $130,000
 * salary paid fortnightly however the amount is expressed. A period the inflow's
 * effective dates clip is a part period however well its length fits, as is one on
 * a cadence with no usable interval.
 *
 * This is the period's fit against the cycle alone. Whether the money lands on
 * every turn of that cycle is a separate question — see
 * {@link arrivesOnlySomePayPeriods} — and an inflow that lands only in some still
 * has periods that fit its cadence exactly.
 */
export function isPeriodOnCadence(inflow: ReconciledInflow, period: PayPeriod): boolean {
  const { span } = payCycle(inflow)
  const days = periodDayCount(period)
  return (
    span !== null &&
    activeDaysInPeriod(inflow, period) === days &&
    spansWholeCadenceTurn(span, days)
  )
}

/**
 * Which basis an expected figure was computed on. `cadence` divides the annual
 * figure by the inflow cadence's periods per year, the period being one whole turn
 * of it. `part_cycle` scales that same per-period amount by the days measured over
 * the days one whole turn spans. `calendar_days` apportions the annual figure by
 * the period's share of the financial year, the only basis left where there is no
 * pay cycle to scale against — no inflow at all, or one whose cadence states no
 * usable interval. Two bases compute nothing, the figure being null rather than a
 * smoothed share: `occasional`, where the money lands only in some turns of the
 * cycle, and `one_off`, where it lands on a single day and belongs to no cycle at
 * all. Both are read across the year instead.
 */
export type ExpectationBasis = 'cadence' | 'part_cycle' | 'calendar_days' | 'occasional' | 'one_off'

/**
 * Which of the two things put an expectation on the `part_cycle` basis, so that a
 * reader is told which one they are looking at. Null on every other basis.
 *
 * - `part_period` — the pay period itself is not one whole turn of the cycle: a
 *   first or last slip in a job, an off-cycle or back-pay slip, or a cadence whose
 *   turn the period does not fit. The figures are genuinely a fraction of a
 *   period's pay.
 * - `inflow_dates` — the period IS one whole turn, and it is the inflow that runs
 *   for only part of it, its effective dates clipping the days measured. A pay rise
 *   modelled the documented way — the old rate ending, a new dated one starting —
 *   puts both of a fortnight's groups here. Nothing is approximated: each share is
 *   exact and the shares over the period sum to one whole period at the blended
 *   rate, so a variance against one of them is real rather than proration noise.
 *
 * A period that is neither a whole turn nor fully covered reads as `part_period`:
 * the period's own length is the more fundamental fact, and it is the one that makes
 * the figure a fraction of a period rather than a whole one.
 */
export type PartCycleReason = 'part_period' | 'inflow_dates'

/** Which basis an expectation rests on, and — on `part_cycle` — which case it is. */
export interface BasisReading {
  readonly basis: ExpectationBasis
  readonly partCycleReason: PartCycleReason | null
}

/**
 * Which basis an expectation drawn from `inflow` rests on for `period`: `one_off`
 * where the money lands on a day of its own, and `occasional` where it lands only in
 * some turns of the cycle, neither of which this period is expected to carry; the
 * `cadence` for one whole turn of its pay cycle; `part_cycle` for part of one — with
 * the reason it is part of one, since a short period and a dated inflow read very
 * differently to whoever is looking at the variance — and `calendar_days` only where
 * there is no cycle to scale against, no inflow at all or one whose cadence states no
 * usable interval. The two that expect nothing are read first: a one-off states no
 * cadence, so the questions the rest ask of one have no answer. The cycle the rest
 * read is the one the money arrives on, so this agrees with {@link isPeriodOnCadence}
 * however the inflow's amount is expressed.
 */
export function readBasis(inflow: ReconciledInflow | undefined, period: PayPeriod): BasisReading {
  if (inflow === undefined) {
    return { basis: 'calendar_days', partCycleReason: null }
  }
  if (isOneOff(inflow)) {
    return { basis: 'one_off', partCycleReason: null }
  }
  if (arrivesOnlySomePayPeriods(inflow)) {
    return { basis: 'occasional', partCycleReason: null }
  }
  const { span } = payCycle(inflow)
  if (span === null) {
    return { basis: 'calendar_days', partCycleReason: null }
  }
  const days = periodDayCount(period)
  if (!spansWholeCadenceTurn(span, days)) {
    return { basis: 'part_cycle', partCycleReason: 'part_period' }
  }
  if (activeDaysInPeriod(inflow, period) !== days) {
    return { basis: 'part_cycle', partCycleReason: 'inflow_dates' }
  }
  return { basis: 'cadence', partCycleReason: null }
}

/**
 * Annualises an inflow's steady per-period gross to whole cents. The per-period
 * gross is `hourlyRateCents × hoursPerPeriod` rounded to whole cents for a
 * `wage` and `amountCents` for a `salary` or `other`, with missing figures taken
 * as zero; the amount's own `schedule` is normalised by `annualCents` — the pay
 * cadence has no part in it, the amount meaning what it says over the period it
 * names — so an `every_n_weeks`/`every_n_months` inflow with no usable interval
 * annualises to zero, as does one stating no schedule at all: there is no period to
 * multiply the amount up from. Whether the money lands every period has no part in it
 * either: an inflow worth $6,600 a year is worth $6,600 a year however few of the
 * year's fortnights it arrives in. The inflow's effective dates are not applied
 * here — this is the full-year rate a period's expectation is drawn from.
 *
 * A one-off's amount comes back unchanged. It is the whole payment rather than a
 * figure expressed over a period, so there is no frequency to multiply it by: a
 * $40,000 redundancy is $40,000 of money in, not $40,000 a period.
 */
export function annualInflowGrossCents(inflow: ReconciledInflow): Money {
  if (isOneOff(inflow)) {
    return inflow.amountCents ?? 0
  }
  if (inflow.schedule === undefined) {
    return 0
  }
  const perPeriodCents =
    inflow.type === 'wage'
      ? Math.round((inflow.hourlyRateCents ?? 0) * (inflow.hoursPerPeriod ?? 0))
      : (inflow.amountCents ?? 0)
  return annualCents(perPeriodCents, inflow.schedule, inflow.interval)
}

/**
 * The gross the plan projects for one pay period, or **null** for an inflow no
 * period holds an expectation for: one arriving only in some pay periods, or a
 * one-off, whose money belongs to the day it lands on. Neither has a per-period
 * figure at all, and a smoothed share would invent one, reporting every period as
 * off plan in one direction or the other.
 *
 * A period on the inflow's pay cadence gets the annualised gross divided by that
 * cadence's periods per year, rounded to the nearest cent — the steady amount the
 * employer pays each period, so a $130,000 salary paid fortnightly expects $5,000.00
 * exactly. The remainder of an annual figure that does not divide evenly is dropped
 * rather than spread, this being a per-period rate to hold one slip against and not
 * an allocation that has to sum back to the year. Any other period takes that same
 * per-period amount and scales it by the days of the period the inflow is effective
 * for, over the days one whole turn of the cadence spans: a window that covers none
 * of the period projects nothing, half a fortnight projects half a fortnight's pay,
 * and a mid-period pay rise modelled as one dated inflow ending and another starting
 * has the two part-period expectations sum to exactly the whole period's amount. The
 * financial year is the unit only for a cadence with no nominal length at all.
 */
export function expectedPeriodGrossCents(
  inflow: ReconciledInflow,
  period: PayPeriod,
  financialYear: number,
): Money | null {
  if (isUnmeasuredPerPeriod(inflow)) {
    return null
  }
  const annualGrossCents = annualInflowGrossCents(inflow)
  // A cadence with no usable interval is never on-cadence, so periods per year is
  // never the zero it returns for one.
  if (isPeriodOnCadence(inflow, period)) {
    return Math.round(annualGrossCents / payCadencePeriodsPerYear(inflow))
  }
  return prorateAnnualAcrossUnit(
    annualGrossCents,
    activeDaysInPeriod(inflow, period),
    payCycleUnit(inflow, period) ?? financialYearUnit(financialYear),
  )
}
