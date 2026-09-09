/**
 * A taxable one-off inflow's stored tax treatment, its mapping to the
 * `@nest/tax` engine's own names, and the preservation-age test that chooses
 * between the two concessional rates on a termination payment.
 */

import type { OneOffTaxTreatment, TaxYearConfig } from '@nest/tax'

/** A taxable one-off's stored tax treatment. */
export type StoredOneOffTaxTreatment =
  'ordinary' | 'genuine_redundancy' | 'employment_termination' | 'unused_leave'

/** Each stored tax treatment, named as the engine names it. */
export const ENGINE_ONE_OFF_TREATMENTS: Record<StoredOneOffTaxTreatment, OneOffTaxTreatment> = {
  ordinary: 'ordinary',
  genuine_redundancy: 'genuineRedundancy',
  employment_termination: 'employmentTermination',
  unused_leave: 'unusedLeave',
}

/**
 * The engine treatment a stored value names. An absent or unrecognised value
 * reads as `ordinary` — assessable in full, at marginal rates — so a one-off
 * carrying no treatment is taxed as ordinary income rather than crashing a
 * lookup.
 */
export function engineOneOffTreatment(stored: string | null): OneOffTaxTreatment {
  return stored != null && stored in ENGINE_ONE_OFF_TREATMENTS
    ? ENGINE_ONE_OFF_TREATMENTS[stored as StoredOneOffTaxTreatment]
    : 'ordinary'
}

/**
 * Whether a member born on `dateOfBirth` had reached `config`'s preservation age by
 * `onDate`, which is what chooses between the two concessional rates on a
 * termination payment. An unknown date of birth reads as below it — the higher rate,
 * so a missing figure understates the payment rather than the tax on it.
 */
export function atPreservationAgeOn(
  dateOfBirth: string | null,
  onDate: string,
  config: TaxYearConfig,
): boolean {
  if (dateOfBirth === null) {
    return false
  }
  const reached = new Date(`${dateOfBirth}T00:00:00Z`)
  reached.setUTCFullYear(reached.getUTCFullYear() + config.super.preservationAge)
  return new Date(`${onDate}T00:00:00Z`) >= reached
}
