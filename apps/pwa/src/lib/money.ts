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

/** Rounds to at most one decimal and drops a trailing `.0` (e.g. `1.2`, `150`). */
function compactMagnitude(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}

/**
 * Formats integer cents as abbreviated whole-dollar currency for dense labels
 * (e.g. axis ticks): `$0`, `$500`, `$50k`, `$150k`, `$1.2M`, and negatives like
 * `-$50k`. Thousands take `k` and millions `M`, at most one decimal with a trailing
 * `.0` trimmed; sub-thousand amounts round to whole dollars.
 */
export function formatCompactDollars(cents: number): string {
  const dollars = cents / 100
  const sign = dollars < 0 ? '-' : ''
  const abs = Math.abs(dollars)
  if (abs >= 1_000_000) {
    return `${sign}$${compactMagnitude(abs / 1_000_000)}M`
  }
  if (abs >= 1_000) {
    return `${sign}$${compactMagnitude(abs / 1_000)}k`
  }
  return `${sign}$${Math.round(abs)}`
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
    return POSITIVE_MONEY_COLOR
  }
  if (cents < 0) {
    return NEGATIVE_MONEY_COLOR
  }
  return undefined
}

const POSITIVE_MONEY_COLOR =
  'light-dark(var(--mantine-color-positive-7), var(--mantine-color-positive-4))'
const NEGATIVE_MONEY_COLOR =
  'light-dark(var(--mantine-color-negative-7), var(--mantine-color-negative-4))'

/**
 * The money-sign colour for a figure known to be non-zero — a delta between two
 * different amounts, or a shift that has already been shown to move. Always
 * defined: positive amounts take the `positive` token, everything else the
 * `negative` one, so a caller need not thread `undefined` through.
 */
export function signMoneyColor(cents: number): string {
  return cents > 0 ? POSITIVE_MONEY_COLOR : NEGATIVE_MONEY_COLOR
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

/**
 * The deductible share of a cost: `fullAmountCents` at `workUsePercent`,
 * rounded to the nearest cent.
 *
 * The percentage carries two decimal places, so the arithmetic runs in
 * hundredths of a percent to keep the numerator an exact integer — the only
 * rounding is the final one, and it lands on the same cent Postgres's
 * `deduction_work_use_apportioned` check computes in exact numeric. The two
 * must agree: a save whose `amount_cents` disagrees with the constraint is
 * refused outright.
 */
export function workUseAmountCents(fullAmountCents: number, workUsePercent: number): number {
  const hundredthsOfAPercent = Math.round(workUsePercent * 100)
  return Math.round((fullAmountCents * hundredthsOfAPercent) / 10_000)
}
