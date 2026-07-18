const currency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

/** Formats integer cents as an AUD currency string (e.g. `$1,234.56`). */
export function formatCents(cents: number): string {
  return currency.format(cents / 100)
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
