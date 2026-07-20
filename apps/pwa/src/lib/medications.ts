import { annualCents } from '@nest/plan'
import type { Tables } from './database.types'

export type Medication = Tables<'medication'>

/**
 * The household's total annual medication cost: each medication's amount
 * annualised by its frequency (the `every_n_weeks` cadence uses its interval),
 * summed. This is the annual figure a `derived_source = 'medication'` budget line
 * takes as its amount.
 */
export function medicationsAnnualTotalCents(medications: Medication[]): number {
  return medications.reduce(
    (total, medication) =>
      total +
      annualCents(
        medication.amount_cents,
        medication.frequency,
        medication.interval_weeks ?? undefined,
      ),
    0,
  )
}
