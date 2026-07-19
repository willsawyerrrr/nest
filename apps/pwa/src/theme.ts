import { createTheme, type MantineColorsTuple } from '@mantine/core'

/**
 * The app's primary scale: a 10-shade emerald ramp (light → dark). Retune the
 * whole app's accent here — every `primaryColor` surface derives from it.
 */
const emerald: MantineColorsTuple = [
  '#ecfdf5',
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

/** Shared Mantine theme for the PWA, anchored on the emerald primary. */
export const theme = createTheme({
  primaryColor: 'emerald',
  colors: { emerald },
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
})

/**
 * The scheme-aware colour for a signed money figure: green for a positive
 * amount, red for a negative one, and inherited text colour for exactly zero.
 * Deliberately distinct from the emerald primary so gains/losses never read as
 * chrome. The `--money-*` vars (see `index.css`) carry AA-contrast pairs for
 * both light and dark schemes via `light-dark()`.
 */
export function moneyColor(cents: number): string | undefined {
  if (cents > 0) {
    return 'var(--money-positive)'
  }
  if (cents < 0) {
    return 'var(--money-negative)'
  }
  return undefined
}

/**
 * Donut colours for each budget group: a harmonious green-anchored ramp that
 * sweeps from deep teal through green and lime to warm gold, skipping blue and
 * purple. Each step stays distinguishable from its neighbours.
 */
export const GROUP_DONUT_COLORS = {
  needs: 'var(--mantine-color-teal-7)',
  wants: 'var(--mantine-color-teal-5)',
  discretionary: 'var(--mantine-color-green-6)',
  temporary: 'var(--mantine-color-lime-7)',
  savings: 'var(--mantine-color-yellow-7)',
  investments: 'var(--mantine-color-orange-6)',
} as const

/** The neutral grey of the leftover-buffer donut segment (After Saving). */
export const BUFFER_DONUT_COLOR = 'var(--mantine-color-gray-5)'
