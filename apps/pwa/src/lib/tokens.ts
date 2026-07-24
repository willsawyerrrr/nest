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

/**
 * Each categorical key's Mantine base colour and per-scheme scale shade. The six
 * budget groups span six distinct hues — indigo, violet, pink, orange, teal,
 * cyan — so a chart or category chip reads as a varied spectrum rather than a
 * single green family; the buffer is neutral grey, tax reuses the negative
 * (cost) family, and salary sacrifice takes the brand lime. Each key resolves to
 * a `light-dark()` pair, a slightly deeper shade on the light surface and a vivid
 * one on the near-black dark base, so every hue stays legible and mutually
 * distinguishable in both schemes.
 */
const categoricalHues = {
  needs: { color: 'indigo', light: 6, dark: 5 },
  wants: { color: 'violet', light: 6, dark: 5 },
  discretionary: { color: 'pink', light: 6, dark: 5 },
  temporary: { color: 'orange', light: 7, dark: 5 },
  savings: { color: 'teal', light: 7, dark: 5 },
  investments: { color: 'cyan', light: 7, dark: 5 },
  buffer: { color: 'gray', light: 6, dark: 5 },
  tax: { color: 'negative', light: 6, dark: 6 },
  sacrifice: { color: 'brand', light: 7, dark: 5 },
} as const satisfies Record<string, { color: string; light: number; dark: number }>

export type ChartColorKey = keyof typeof categoricalHues

/** A CSS ref to a shade of a named Mantine scale. */
function scaleRef(color: string, shade: number): string {
  return `var(--mantine-color-${color}-${shade})`
}

const hueEntries = Object.entries(categoricalHues) as [
  ChartColorKey,
  (typeof categoricalHues)[ChartColorKey],
][]

/**
 * Categorical chart palette, as scheme-aware CSS colour refs, for the summary
 * breakdown. Covers the six budget groups plus the buffer, tax, and salary-
 * sacrifice segments, so a chart references a token instead of an inline hex.
 */
export const chartColors = Object.fromEntries(
  hueEntries.map(([key, { color, light, dark }]) => [
    key,
    `light-dark(${scaleRef(color, light)}, ${scaleRef(color, dark)})`,
  ]),
) as Record<ChartColorKey, string>

/**
 * The Mantine base-colour name for each categorical key, for a `Badge` or
 * `ThemeIcon` `color` prop — which takes a scale name and derives its own
 * scheme-aware shade, so a category chip stays in step with its chart hue.
 */
export const chartColorName = Object.fromEntries(
  hueEntries.map(([key, { color }]) => [key, color]),
) as Record<ChartColorKey, string>

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
