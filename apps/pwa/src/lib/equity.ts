import type { EquityGrant, EquityInstrumentType, VestingFrequency } from '@nest/plan'
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

/** The whole units of a grant exercised and sold, and what remains of each. */
export interface GrantHoldings {
  exercised: number
  sold: number
  /** Granted options not yet exercised; zero for a share grant. */
  unexercised: number
  /** Shares that can still be sold: exercised options (or granted shares) not yet sold. */
  sellable: number
}

/**
 * A grant's exercised and sold units, from the recorded rows, and the headroom
 * left for each — the same limits the database enforces. `ignoreExerciseId` and
 * `ignoreSaleId` leave one row out, for validating an edit of it.
 */
export function grantHoldings(
  grant: EquityGrantRow,
  exercises: readonly EquityExerciseRow[],
  sales: readonly EquitySaleRow[],
  ignoreExerciseId?: string,
  ignoreSaleId?: string,
): GrantHoldings {
  const total = (
    rows: readonly { id: string; grant_id: string; quantity: number }[],
    ignore?: string,
  ) =>
    rows
      .filter((row) => row.grant_id === grant.id && row.id !== ignore)
      .reduce((sum, row) => sum + row.quantity, 0)
  const exercised = total(exercises, ignoreExerciseId)
  const sold = total(sales, ignoreSaleId)
  const isOption = grant.instrument_type === 'option'
  return {
    exercised,
    sold,
    unexercised: isOption ? Math.max(0, grant.quantity - exercised) : 0,
    sellable: Math.max(0, (isOption ? exercised : grant.quantity) - sold),
  }
}

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

/**
 * Maps a stored equity-grant row to the pure `@nest/plan` grant shape the vesting
 * and valuation math consumes, carrying the units its recorded exercises and
 * sales have already moved.
 */
export function equityGrantToPlan(
  grant: EquityGrantRow,
  exercises: readonly EquityExerciseRow[] = [],
  sales: readonly EquitySaleRow[] = [],
): EquityGrant {
  const { exercised, sold } = grantHoldings(grant, exercises, sales)
  return {
    quantity: grant.quantity,
    grantDate: grant.grant_date,
    cliffMonths: grant.cliff_months,
    vestingPeriodMonths: grant.vesting_period_months,
    vestingFrequency: grant.vesting_frequency,
    instrumentType: grant.instrument_type,
    strikePriceCents: grant.strike_price_cents,
    pricePerShareCents: grant.price_per_share_cents,
    exercisedQuantity: exercised,
    soldQuantity: sold,
  }
}
