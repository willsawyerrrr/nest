/*
 * Semantic and chart design tokens. Components reference these names rather than
 * raw hex or ad-hoc Mantine shades, so the palette stays defined in one place.
 */

/** The semantic (non-brand) theme colour names, each a full Mantine scale in `theme.ts`. */
export const semanticColors = {
  brand: 'brand',
  positive: 'positive',
  negative: 'negative',
  warning: 'warning',
  info: 'info',
} as const

export type SemanticColor = keyof typeof semanticColors

/**
 * Categorical chart palette, as CSS-variable colour refs, for the summary
 * breakdown. Covers the six budget groups plus the buffer, tax, and salary-
 * sacrifice segments, so a chart references a token instead of an inline hex.
 */
export const chartColors = {
  needs: 'var(--mantine-color-brand-5)',
  wants: 'var(--mantine-color-brand-3)',
  discretionary: 'var(--mantine-color-info-5)',
  temporary: 'var(--mantine-color-info-3)',
  savings: 'var(--mantine-color-positive-5)',
  investments: 'var(--mantine-color-positive-3)',
  buffer: 'var(--mantine-color-dark-2)',
  tax: 'var(--mantine-color-negative-6)',
  sacrifice: 'var(--mantine-color-positive-8)',
} as const

export type ChartColorKey = keyof typeof chartColors

/** The six budget groups in plot order — the categorical palette a series cycles through. */
export const budgetGroupChartOrder = [
  'needs',
  'wants',
  'discretionary',
  'temporary',
  'savings',
  'investments',
] as const satisfies readonly ChartColorKey[]

/** The ordered categorical palette (budget-group colour refs) for a multi-series chart. */
export const chartPalette: readonly string[] = budgetGroupChartOrder.map((key) => chartColors[key])
