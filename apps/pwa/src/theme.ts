import { createTheme, type MantineColorsTuple } from '@mantine/core'

/**
 * The single source of truth for the app's colours: one warm-neutral system with
 * a restrained amber accent. Retune the palette here and it flows everywhere —
 * component chrome, the Summary donut, and the semantic money colours all read
 * from these scales.
 */

/** The restrained accent: a muted, earthy amber used as `primaryColor`. */
const amber: MantineColorsTuple = [
  '#fbf4e8',
  '#f2e6cf',
  '#e6cc9f',
  '#dab26c',
  '#d09f45',
  '#c9932c',
  '#c08722',
  '#9c6a1a',
  '#7c5315',
  '#5f3f10',
]

/** Warm-tinted neutral grays — the calm backdrop the whole UI sits on (light mode). */
const stone: MantineColorsTuple = [
  '#faf8f5',
  '#f2efe9',
  '#e9e4dc',
  '#dcd5ca',
  '#c9c0b2',
  '#a89e8d',
  '#847a68',
  '#5c5346',
  '#403a30',
  '#2a2620',
]

/** Warm charcoal surfaces for dark mode — intentional warmth, never a muddy blue-gray. */
const warmDark: MantineColorsTuple = [
  '#c9c3bb',
  '#afa89f',
  '#98918a',
  '#635d55',
  '#3d3934',
  '#302c28',
  '#282521',
  '#1c1a17',
  '#161412',
  '#100f0d',
]

/** Semantic positive money: a muted sage/forest green, distinct from the amber accent. */
const positive: MantineColorsTuple = [
  '#eef4ec',
  '#dbe7d6',
  '#b9d0ae',
  '#93b783',
  '#74a361',
  '#5f9749',
  '#528b3d',
  '#3f6d2f',
  '#325726',
  '#26431d',
]

/** Semantic negative money: a muted brick red, distinct from the amber accent. */
const negative: MantineColorsTuple = [
  '#fbecea',
  '#f4d6d2',
  '#e8aca5',
  '#dc8177',
  '#d26254',
  '#cb4f40',
  '#c0392b',
  '#9e2b20',
  '#7e2119',
  '#5f1913',
]

export const theme = createTheme({
  primaryColor: 'amber',
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  colors: {
    amber,
    stone,
    positive,
    negative,
    // Warm the neutral chrome by overriding Mantine's default gray/dark scales.
    gray: stone,
    dark: warmDark,
  },
})

/**
 * The Summary allocation categories, each a `light-dark()` pair drawn from the
 * warm palette: earthy, mutually distinguishable hues that stay legible on both
 * the light and dark card. The Buffer slice uses a neutral warm gray.
 */
export const CATEGORY_COLORS = {
  needs: 'light-dark(#b5623c, #d08a63)',
  wants: 'light-dark(#c08722, #d4a24a)',
  discretionary: 'light-dark(#8a7f24, #bcae44)',
  temporary: 'light-dark(#a05c72, #c58aa0)',
  savings: 'light-dark(#52864a, #7bb069)',
  investments: 'light-dark(#2f7d72, #4fa89a)',
} as const

/** The Summary buffer slice colour (a neutral warm gray, scheme-aware). */
export const BUFFER_COLOR = 'light-dark(var(--mantine-color-stone-4), var(--mantine-color-dark-3))'

/**
 * A scheme-aware colour for a money figure by its sign: green for positive, red
 * for negative, and inherited (neutral) for zero. Deeper shades in light mode,
 * lighter shades in dark mode, so both meet WCAG AA against the card.
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
