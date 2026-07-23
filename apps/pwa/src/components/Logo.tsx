import { Box, rem } from '@mantine/core'

interface LogoProps {
  /** `lockup` pairs the mark with the "nest" wordmark; `mark` is the icon alone. */
  variant?: 'lockup' | 'mark'
  /** Height of the mark in pixels; the lockup wordmark scales from it. */
  size?: number
  className?: string
}

/**
 * The nest brand: the goose-in-nest mark, optionally beside the "nest" wordmark.
 * The mark renders `public/icon.svg` by URL, so edits to that single source
 * flow straight through to every surface. The wordmark is live text in the
 * theme heading font (Space Grotesk), so it tracks headings exactly rather than
 * baking in a rasterized image.
 *
 * The goose was drawn for the near-black canvas, so its off-white body would
 * vanish on light surfaces. `markStyle` restores its canvas as a rounded tile
 * behind the mark in light mode only via `light-dark(...)`, keeping dark mode on
 * transparency exactly as before.
 */
const markStyle = {
  display: 'block',
  flexShrink: 0,
  background: 'light-dark(var(--mantine-color-dark-6), transparent)',
} as const

export function Logo({ variant = 'lockup', size = 32, className }: LogoProps) {
  if (variant === 'mark') {
    return (
      <img
        src="/icon.svg"
        alt="nest"
        width={size}
        height={size}
        className={className}
        style={{ ...markStyle, borderRadius: rem(size * 0.22) }}
      />
    )
  }
  return (
    <Box
      component="span"
      role="img"
      aria-label="nest"
      className={className}
      display="inline-flex"
      style={{ alignItems: 'center', gap: rem(size * 0.32) }}
    >
      <img
        src="/icon.svg"
        alt=""
        width={size}
        height={size}
        style={{ ...markStyle, borderRadius: rem(size * 0.22) }}
      />
      <span
        aria-hidden
        style={{
          fontFamily: 'var(--mantine-font-family-headings)',
          fontWeight: 600,
          fontSize: rem(size * 0.9),
          letterSpacing: rem(size * -0.03),
          lineHeight: 1,
          color: 'var(--mantine-color-text)',
        }}
      >
        nest
      </span>
    </Box>
  )
}
