import { createTheme, type MantineColorsTuple } from '@mantine/core'

/**
 * A muted slate (blue-grey) scale, lightest to darkest. It carries the app's
 * primary/interactive surfaces as a restrained neutral rather than a vivid hue,
 * letting content — and the green/red money accents — lead. Shade 9 matches the
 * deep-slate chrome (`theme-color`, splash) used across the PWA shell and icon.
 */
const slate: MantineColorsTuple = [
  '#f5f7fa',
  '#e8ecf1',
  '#cbd5e1',
  '#aab8c9',
  '#8496ad',
  '#657a93',
  '#4c6178',
  '#3a4c60',
  '#28313f',
  '#0f172a',
]

/**
 * Cohesive, desaturated donut segment colours for the six budget groups, keyed
 * by group. They stay within a cool blue → teal → sage arc — harmonious with the
 * slate primary, with no clashing purple or indigo — and are spaced by hue and
 * lightness so adjacent slices remain distinguishable.
 */
export const budgetGroupColors = {
  needs: '#2f4a63',
  wants: '#416a86',
  discretionary: '#558f8c',
  temporary: '#7aa6a0',
  savings: '#6b8aa6',
  investments: '#86a37f',
} as const

/** The neutral colour of the leftover-buffer segment in the allocation donut. */
export const bufferColor = 'var(--mantine-color-gray-5)'

/** Shared Mantine theme for the PWA. */
export const theme = createTheme({
  primaryColor: 'slate',
  colors: { slate },
  // Keep the dark-mode slate primary light enough to read against the dark body;
  // `autoContrast` then picks legible text on every filled slate surface.
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
})
