/**
 * Schedule normalization: any frequency to a whole-cent annual total and to the
 * plan's primary fortnightly figure.
 */

import type { Frequency, Money } from './index'

/** Fortnights per year; fortnightly figures divide an annual by this. */
export const FORTNIGHTS_PER_YEAR = 26

/** Periods per year for each frequency. */
export const PERIODS_PER_YEAR: Readonly<Record<Frequency, number>> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  biannual: 2,
  annual: 1,
}

/** Annualises an amount: `amountCents × periods_per_year`, in whole cents. */
export function annualCents(amountCents: Money, frequency: Frequency): Money {
  return amountCents * PERIODS_PER_YEAR[frequency]
}

/**
 * Normalises an amount to its per-fortnight share: the annual total divided by
 * 26, rounded to whole cents.
 */
export function fortnightlyCents(amountCents: Money, frequency: Frequency): Money {
  return Math.round(annualCents(amountCents, frequency) / FORTNIGHTS_PER_YEAR)
}
