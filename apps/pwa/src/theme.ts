import { createTheme, rem, type MantineColorsTuple, type MantineTheme } from '@mantine/core'

/*
 * Bold, dark-first design system. Dark is the primary scheme; light mode is a
 * high-contrast paper counterpart. Every colour is a named Mantine scale so
 * components reference tokens, never raw hex.
 */

// Body font stack; headings layer Space Grotesk on top of the same fallbacks.
const bodyFontFallback =
  'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const bodyFontFamily = `"Inter Variable", ${bodyFontFallback}`
const headingFontFamily = `"Space Grotesk Variable", ${bodyFontFallback}`

/*
 * Neutral scale for both schemes. In dark mode Mantine maps the page body to
 * `dark-7` (#0b0f14), elevated default surfaces (cards, inputs) to `dark-6`
 * (#141a21) with `dark-5` (#1b232c) one step higher, subtle borders to `dark-4`
 * (#26303a), dimmed text to `dark-2` (#8b99a6), and body text to `dark-0`
 * (#e6edf3) — so a bordered default surface renders the elevated aesthetic with
 * no per-component background.
 */
const dark: MantineColorsTuple = [
  '#e6edf3',
  '#c3ccd6',
  '#8b99a6',
  '#5c6b78',
  '#26303a',
  '#1b232c',
  '#141a21',
  '#0b0f14',
  '#080b0f',
  '#05070a',
]

/** Brand accent: electric lime. `primaryShade` pins the vivid shade 5 in both schemes. */
const brand: MantineColorsTuple = [
  '#f7ffe1',
  '#edffba',
  '#dcff85',
  '#caff4d',
  '#bcf91f',
  '#b6f400',
  '#a1d900',
  '#89b800',
  '#719800',
  '#587600',
]

/** Positive / money-up: bright green, distinct from the brand lime. */
const positive: MantineColorsTuple = [
  '#e6fcf0',
  '#c3f7dd',
  '#97efc4',
  '#67e6a8',
  '#4be195',
  '#3ddc84',
  '#22c46c',
  '#16a75a',
  '#0d8748',
  '#036436',
]

/** Negative / money-down: magenta-red. */
const negative: MantineColorsTuple = [
  '#ffe8ec',
  '#ffc9d2',
  '#ffa1b1',
  '#ff7690',
  '#ff5c7b',
  '#ff4d6d',
  '#ed2f52',
  '#d01840',
  '#a80f31',
  '#7d0a24',
]

/** Warning: amber. */
const warning: MantineColorsTuple = [
  '#fff8e1',
  '#ffecb3',
  '#ffe08a',
  '#ffd15c',
  '#fbbb3c',
  '#f5a524',
  '#db8c0f',
  '#b57109',
  '#8f5806',
  '#6b4103',
]

/** Info: cyan. */
const info: MantineColorsTuple = [
  '#e0fbff',
  '#bbf3fc',
  '#8ae9f7',
  '#53dcf0',
  '#33d4ec',
  '#22d3ee',
  '#10b6d0',
  '#0894ab',
  '#037286',
  '#015462',
]

/** Shared Mantine theme for the PWA. */
export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 5, dark: 5 },
  autoContrast: true,
  colors: { dark, brand, positive, negative, warning, info },

  defaultRadius: 'md',
  radius: {
    xs: rem(4),
    sm: rem(6),
    md: rem(10),
    lg: rem(14),
    xl: rem(20),
  },

  // Adds a sub-`xs` step so tight rows use a token, not a raw `gap={4}`.
  spacing: { xxs: rem(4) },

  fontFamily: bodyFontFamily,
  fontFamilyMonospace: 'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
  headings: {
    fontFamily: headingFontFamily,
    fontWeight: '700',
    // Display-scale, tightly-tracked h1 for page titles, stepping down sharply to
    // clearly-subordinate section headings. h1 carries a negative letter-spacing
    // so the heavy Space Grotesk reads as a bold display line.
    sizes: {
      h1: { fontSize: rem(38), lineHeight: '1.05', fontWeight: '700' },
      h2: { fontSize: rem(28), lineHeight: '1.15', fontWeight: '700' },
      h3: { fontSize: rem(21), lineHeight: '1.3', fontWeight: '600' },
      h4: { fontSize: rem(18), lineHeight: '1.35', fontWeight: '600' },
      h5: { fontSize: rem(16), lineHeight: '1.4', fontWeight: '600' },
      h6: { fontSize: rem(14), lineHeight: '1.4', fontWeight: '600' },
    },
  },

  components: {
    Card: {
      defaultProps: { withBorder: true, radius: 'md', padding: 'lg' },
      styles: {
        // A clear step above the page base: a soft drop shadow in both schemes,
        // plus a brighter hairline inset top-edge highlight in dark to lift the
        // elevated surface off the near-black canvas.
        root: {
          boxShadow:
            'light-dark(var(--mantine-shadow-sm), 0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 10px 30px rgba(0, 0, 0, 0.5))',
        },
      },
    },
    Button: {
      defaultProps: { radius: 'md' },
      // The primary action (default/`filled`, brand-coloured) carries a subtle
      // electric-lime glow so it reads as the assertive CTA from the mockup; a
      // coloured or non-filled button (e.g. a red delete, a ghost cancel) keeps a
      // flat surface.
      styles: (_theme: MantineTheme, props: { variant?: string; color?: string }) => ({
        root: {
          fontWeight: 600,
          boxShadow:
            props.color == null && (props.variant == null || props.variant === 'filled')
              ? '0 4px 16px color-mix(in srgb, var(--mantine-color-brand-5) 19%, transparent)'
              : undefined,
        },
      }),
    },
    Badge: {
      defaultProps: { variant: 'light', radius: 'sm' },
    },
    ActionIcon: {
      defaultProps: { variant: 'subtle' },
    },
    TextInput: { defaultProps: { size: 'sm', radius: 'md' } },
    NumberInput: { defaultProps: { size: 'sm', radius: 'md' } },
    Select: { defaultProps: { size: 'sm', radius: 'md' } },
    SegmentedControl: { defaultProps: { size: 'sm', radius: 'md' } },
    Switch: { defaultProps: { size: 'sm' } },
    Checkbox: { defaultProps: { size: 'sm', radius: 'sm' } },
  },
})
