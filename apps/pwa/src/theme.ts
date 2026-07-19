import { createTheme } from '@mantine/core'

/**
 * Shared Mantine theme for the PWA. A single cohesive blue is the primary
 * accent used across every interactive surface; green and red are reserved
 * for signed money (see `moneyColor`) and never double as the primary.
 */
export const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
})

/**
 * The colour for a signed money figure: green when positive, red when
 * negative, and the inherited text colour at zero. Each non-zero result is a
 * `light-dark()` pair tuned to clear WCAG AA in both schemes, and deliberately
 * sits outside the blue primary so gains and losses read at a glance.
 */
export function moneyColor(cents: number): string | undefined {
  if (cents > 0) {
    return 'light-dark(#1f7a34, var(--mantine-color-green-4))'
  }
  if (cents < 0) {
    return 'light-dark(var(--mantine-color-red-9), var(--mantine-color-red-4))'
  }
  return undefined
}
