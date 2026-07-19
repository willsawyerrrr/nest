import { createTheme, type MantineColorsTuple } from '@mantine/core'

/**
 * The app's primary hue: a cohesive emerald scale (shades 0–9, light → dark).
 * Retuning the whole app's accent is a matter of editing this one ramp.
 */
const emerald: MantineColorsTuple = [
  '#e6f7ef',
  '#d1fae5',
  '#a7f3d0',
  '#6ee7b7',
  '#34d399',
  '#10b981',
  '#059669',
  '#047857',
  '#065f46',
  '#064e3b',
]

/**
 * Semantic colours for signed money, kept deliberately distinct from the emerald
 * primary so a positive amount never blurs into an accent: Mantine's grassier
 * `green` marks gains and `red` marks losses. Shared by every money figure whose
 * sign carries meaning.
 */
export const MONEY_POSITIVE = 'green'
export const MONEY_NEGATIVE = 'red'

/** The semantic colour for a signed money amount, or `undefined` at exactly zero. */
export function moneyColor(cents: number): string | undefined {
  if (cents > 0) {
    return MONEY_POSITIVE
  }
  if (cents < 0) {
    return MONEY_NEGATIVE
  }
  return undefined
}

/** Shared Mantine theme for the PWA. */
export const theme = createTheme({
  primaryColor: 'emerald',
  colors: { emerald },
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
})
