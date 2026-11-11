import { grantHoldings } from '@nest/household'
import type { EquityInstrumentType, VestingFrequency } from '@nest/plan'
import type { EquityExerciseRow } from '../hooks/useEquityExercises'
import type { EquityGrantRow } from '../hooks/useEquityGrants'
import type { EquitySaleRow } from '../hooks/useEquitySales'

/** Human-readable labels for each equity instrument type, for forms and lists. */
export const EQUITY_INSTRUMENT_TYPES: { value: EquityInstrumentType; label: string }[] = [
  { value: 'option', label: 'Options' },
  { value: 'share', label: 'Shares' },
]

/** Human-readable labels for each vesting frequency, for forms and lists. */
export const VESTING_FREQUENCIES: { value: VestingFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
]

/**
 * The reason an exercise of `quantity` options cannot be saved, or null when it
 * can: exercised options cannot exceed the grant, nor fall below what has been
 * sold. `ignoreId` leaves the exercise being edited out of the totals.
 */
export function exerciseError(
  grant: EquityGrantRow,
  exercises: readonly EquityExerciseRow[],
  sales: readonly EquitySaleRow[],
  quantity: number,
  ignoreId?: string,
): string | null {
  const { exercised, sold, unexercised } = grantHoldings(grant, exercises, sales, ignoreId)
  if (quantity > unexercised) {
    return `Only ${unexercised.toLocaleString()} options are left to exercise.`
  }
  if (exercised + quantity < sold) {
    return 'Exercised options cannot fall below the shares already sold.'
  }
  return null
}

/**
 * The reason a sale of `quantity` shares cannot be saved, or null when it can:
 * sold shares cannot exceed those exercised (an option grant) or granted (a share
 * grant). `ignoreId` leaves the sale being edited out of the totals.
 */
export function saleError(
  grant: EquityGrantRow,
  exercises: readonly EquityExerciseRow[],
  sales: readonly EquitySaleRow[],
  quantity: number,
  ignoreId?: string,
): string | null {
  const { sellable } = grantHoldings(grant, exercises, sales, undefined, ignoreId)
  if (quantity > sellable) {
    return `Only ${sellable.toLocaleString()} shares are left to sell.`
  }
  return null
}

export { equityGrantToPlan, grantHoldings } from '@nest/household'
export type { GrantHoldings } from '@nest/household'
