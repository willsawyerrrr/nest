import { useMediaQuery } from '@mantine/hooks'

/**
 * The `min-width` breakpoint at and above which a responsive list renders its
 * dense desktop row rather than its stacked mobile card.
 */
export const WIDE_BREAKPOINT = '48em'

/**
 * Whether the viewport is at least `WIDE_BREAKPOINT` wide, so a responsive list
 * should render its dense desktop row rather than its stacked mobile card.
 */
export function useIsWide() {
  return useMediaQuery(`(min-width: ${WIDE_BREAKPOINT})`)
}
