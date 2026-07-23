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

/** Formats integer cents as a fortnightly rate (e.g. `$1,234.56 / fn`). */
export function formatPerFortnight(cents: number): string {
  return `${formatCents(cents)} / fn`
}

/** Formats integer cents as an annual rate (e.g. `$1,234.56 / year`). */
export function formatPerYear(cents: number): string {
  return `${formatCents(cents)} / year`
}

/**
 * The text colour for a signed money figure: the `positive` token for a positive
 * amount, the `negative` token for a negative one, and the inherited neutral
 * colour for zero. This is the app's one money-sign signal, drawn from the
 * semantic theme tokens and kept distinct from the brand lime. Each sign resolves
 * per scheme via `light-dark` — a darker shade on light paper, a lighter shade on
 * the dark base — so the figure clears WCAG AA contrast in both schemes.
 */
export function moneyColor(cents: number): string | undefined {
  if (cents > 0) {
    return 'light-dark(var(--mantine-color-positive-7), var(--mantine-color-positive-4))'
  }
  if (cents < 0) {
    return 'light-dark(var(--mantine-color-negative-7), var(--mantine-color-negative-4))'
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
