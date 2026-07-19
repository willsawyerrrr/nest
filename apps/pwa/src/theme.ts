import { createTheme } from '@mantine/core'

/**
 * Shared Mantine theme for the PWA. Teal is the single primary hue — retune it
 * here and every primary surface (buttons, active nav, progress, tinted rows,
 * focus rings) follows. Green and red are reserved as semantic money colours
 * (see `moneyColor` in `lib/money`), kept deliberately distinct from the teal
 * primary; neutral grays carry everything else.
 */
export const theme = createTheme({
  primaryColor: 'teal',
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
})
