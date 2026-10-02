// Conversions between `NumberInput` values and the numeric columns they edit.

/** A `NumberInput` value as a finite non-negative number, or `NaN` when blank or invalid. */
export function toNonNegative(value: number | string): number {
  const number = typeof value === 'number' ? value : Number.parseFloat(value)
  return value !== '' && Number.isFinite(number) && number >= 0 ? number : Number.NaN
}

/**
 * A distance or hours figure as a `NumberInput` value, or `''` when unset.
 * `distance_km` and `work_from_home_hours` are `numeric(8,2)`, so may arrive as strings.
 */
export function toNumericValue(km: number | string | null | undefined): number | string {
  if (km == null || km === '') {
    return ''
  }
  return typeof km === 'number' ? km : Number.parseFloat(km)
}
