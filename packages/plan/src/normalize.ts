/**
 * Schedule normalization: any frequency to a whole-cent annual total and to the
 * plan's primary fortnightly figure.
 */

import type { Frequency, Money } from './index'

/** Fortnights per year; fortnightly figures divide an annual by this. */
export const FORTNIGHTS_PER_YEAR = 26

/** Weeks per year; the `every_n_weeks` cadence divides this by its interval. */
export const WEEKS_PER_YEAR = 52

/** Months per year; the `every_n_months` cadence divides this by its interval. */
export const MONTHS_PER_YEAR = 12

/** The fixed-cadence frequencies, each with a constant number of periods per year. */
type FixedFrequency = Exclude<Frequency, 'every_n_weeks' | 'every_n_months'>

/** Periods per year for each fixed-cadence frequency. */
export const PERIODS_PER_YEAR: Readonly<Record<FixedFrequency, number>> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  biannual: 2,
  annual: 1,
}

/** Whether `interval` is a usable interval count (a positive integer). */
function isValidInterval(interval: number | undefined): interval is number {
  return interval !== undefined && Number.isInteger(interval) && interval >= 1
}

/**
 * Annualises an amount to whole cents. Fixed frequencies multiply by their
 * periods per year, exactly. `every_n_weeks` — an amount received once every
 * `interval` weeks — is `round(amountCents × 52 / interval)`; `every_n_months` —
 * once every `interval` months — is `round(amountCents × 12 / interval)`. An
 * absent or non-positive-integer interval defensively annualises to zero.
 */
export function annualCents(amountCents: Money, frequency: Frequency, interval?: number): Money {
  if (frequency === 'every_n_weeks') {
    if (!isValidInterval(interval)) {
      return 0
    }
    return Math.round((amountCents * WEEKS_PER_YEAR) / interval)
  }
  if (frequency === 'every_n_months') {
    if (!isValidInterval(interval)) {
      return 0
    }
    return Math.round((amountCents * MONTHS_PER_YEAR) / interval)
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
  interval?: number,
): Money {
  return Math.round(annualCents(amountCents, frequency, interval) / FORTNIGHTS_PER_YEAR)
}
