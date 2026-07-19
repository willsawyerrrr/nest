const currency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Formats integer cents as an AUD currency string (e.g. `$1,234.56`). */
export function formatCents(cents: number): string {
  return currency.format(cents / 100)
}

/**
 * The semantic colour for a signed money amount: green for a positive figure,
 * red for a negative one, and none for zero. The single source of truth for the
 * app's positive/negative money convention, kept distinct from the teal primary.
 */
export function moneyColor(cents: number): 'green' | 'red' | undefined {
  if (cents > 0) {
    return 'green'
  }
  if (cents < 0) {
    return 'red'
  }
  return undefined
}

/** Integer cents as a dollars number for a `NumberInput` value, or `''` when unset. */
export function centsToDollars(cents: number | null | undefined): number | '' {
  if (cents == null) {
    return ''
  }
  return cents / 100
}

/** A `NumberInput` dollars value as integer cents, or `null` when blank. */
export function dollarsToCents(value: number | string): number | null {
  if (value === '' || value == null) {
    return null
  }
  const dollars = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(dollars)) {
    return null
  }
  return Math.round(dollars * 100)
}
