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
 * The text colour for a signed money figure: green for a positive amount, red for
 * a negative one, and the inherited neutral colour for zero. This is the app's one
 * money-sign signal, kept distinct from the teal primary. Each sign resolves per
 * scheme via `light-dark` so the figure clears WCAG AA contrast in light and dark.
 */
export function moneyColor(cents: number): string | undefined {
  if (cents > 0) {
    return 'light-dark(#1f7a3d, var(--mantine-color-green-4))'
  }
  if (cents < 0) {
    return 'light-dark(var(--mantine-color-red-9), var(--mantine-color-red-4))'
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
