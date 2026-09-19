/* eslint-disable react/only-export-components -- test-only render helper re-exports Testing Library utilities. */
import type { ReactElement, ReactNode } from 'react'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, type RenderOptions } from '@testing-library/react'
import { HouseholdProvider } from '../components/HouseholdProvider'
import { theme } from '../theme'

function Providers({ children }: { children: ReactNode }) {
  // A fresh client per render, with retries off, so a query that errors in a
  // test fails once rather than retrying with backoff and stalling it.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <MantineProvider theme={theme} env="test">
      <QueryClientProvider client={queryClient}>
        <HouseholdProvider householdId="h1">{children}</HouseholdProvider>
      </QueryClientProvider>
    </MantineProvider>
  )
}

/** Renders `ui` wrapped in `MantineProvider` so Mantine components have context. */
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: Providers, ...options })
}

/**
 * Opts the current test into the wide (desktop) layout by making `min-width`
 * media queries match, so components that split on `useMediaQuery('(min-width:
 * 48em)')` render their dense-row variant. The test setup restores the narrow
 * default after each test.
 */
export function setWideViewport() {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}

export { screen, within, waitFor, fireEvent, act } from '@testing-library/react'
