/**
 * Schedule normalization: any frequency to a whole-cent annual total and to the
 * plan's primary fortnightly figure.
 */

import type { Frequency, Money } from './index'

/** Fortnights per year; fortnightly figures divide an annual by this. */
export const FORTNIGHTS_PER_YEAR = 26

/** Weeks per year; the `every_n_weeks` cadence divides this by its interval. */
export const WEEKS_PER_YEAR = 52

/** The fixed-cadence frequencies, each with a constant number of periods per year. */
type FixedFrequency = Exclude<Frequency, 'every_n_weeks'>

/** Periods per year for each fixed-cadence frequency. */
export const PERIODS_PER_YEAR: Readonly<Record<FixedFrequency, number>> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  biannual: 2,
  annual: 1,
}

/** Whether `intervalWeeks` is a usable `every_n_weeks` interval (a positive integer). */
function isValidInterval(intervalWeeks: number | undefined): intervalWeeks is number {
  return intervalWeeks !== undefined && Number.isInteger(intervalWeeks) && intervalWeeks >= 1
}

/**
 * Annualises an amount to whole cents. Fixed frequencies multiply by their
 * periods per year, exactly. `every_n_weeks` — an amount received once every
 * `intervalWeeks` weeks — is `round(amountCents × 52 / intervalWeeks)`; an
 * absent or non-positive-integer interval defensively annualises to zero.
 */
export function annualCents(
  amountCents: Money,
  frequency: Frequency,
  intervalWeeks?: number,
): Money {
  if (frequency === 'every_n_weeks') {
    if (!isValidInterval(intervalWeeks)) {
      return 0
    }
    return Math.round((amountCents * WEEKS_PER_YEAR) / intervalWeeks)
  }
  return amountCents * PERIODS_PER_YEAR[frequency]
}

/**
 * Normalises an amount to its per-fortnight share: the annual total divided by
 * 26, rounded to whole cents.
 */
export function fortnightlyCents(
  amountCents: Money,
  frequency: Frequency,
  intervalWeeks?: number,
): Money {
  return Math.round(annualCents(amountCents, frequency, intervalWeeks) / FORTNIGHTS_PER_YEAR)
}
