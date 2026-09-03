/**
 * Schedule normalization: any frequency to a whole-cent annual total, an annual
 * total back out to a per-period figure on any cadence, and either to the plan's
 * primary fortnightly figure.
 */

import type { Frequency, Money } from './index.ts'

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
 * How many periods of `frequency` fall in a year. A fixed frequency has its
 * constant count; `every_n_weeks` is `52 / interval` and `every_n_months` is
 * `12 / interval`, fractional for an interval that does not divide the year
 * evenly. An absent or non-positive-integer interval defensively yields zero, so
 * a caller must guard before dividing by the result. Dividing an annual figure by
 * this count draws a per-period figure from an annual rate; `annualCents` goes the
 * other way and multiplies before dividing, so the two are not exact inverses at
 * the cent.
 */
export function periodsPerYear(frequency: Frequency, interval?: number): number {
  if (frequency === 'every_n_weeks') {
    return isValidInterval(interval) ? WEEKS_PER_YEAR / interval : 0
  }
  if (frequency === 'every_n_months') {
    return isValidInterval(interval) ? MONTHS_PER_YEAR / interval : 0
  }
  return PERIODS_PER_YEAR[frequency]
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
 * Draws a per-period figure from an annual total: the annual divided by the
 * periods of `frequency` in a year, rounded to whole cents — so the rounding lands
 * on the per-period figure and the annual it came from is untouched. An absent or
 * non-positive-integer interval on `every_n_weeks` / `every_n_months` counts no
 * periods and defensively yields zero. `annualCents` goes the other way and
 * multiplies, so the two are not exact inverses at the cent: re-annualising a
 * per-period figure gives what that figure actually adds up to, which may differ
 * from the annual it was drawn from.
 */
export function perPeriodCents(annual: Money, frequency: Frequency, interval?: number): Money {
  const periods = periodsPerYear(frequency, interval)
  if (periods === 0) {
    return 0
  }
  return Math.round(annual / periods)
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
  return perPeriodCents(annualCents(amountCents, frequency, interval), 'fortnightly')
}
