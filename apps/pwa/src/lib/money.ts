const currency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

/** Formats integer cents as an AUD currency string (e.g. `$1,234.56`). */
export function formatCents(cents: number): string {
  return currency.format(cents / 100)
}

/** Renders integer cents as a plain dollars string for form inputs (e.g. `1234.56`). */
export function centsToDollarInput(cents: number | null | undefined): string {
  if (cents == null) {
    return ''
  }
  return (cents / 100).toFixed(2)
}

/** Parses a dollars input into integer cents, rounding to the nearest cent. */
export function dollarsToCents(value: string): number {
  const dollars = Number.parseFloat(value)
  if (!Number.isFinite(dollars)) {
    return 0
  }
  return Math.round(dollars * 100)
}
