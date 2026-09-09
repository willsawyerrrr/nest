import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HouseholdProvider } from '../components/HouseholdProvider'

/**
 * Build a `renderHook` wrapper providing a fresh React Query client with
 * retries disabled (so a query's error surfaces on the first attempt) and the
 * `h1` household every hook test reads under.
 */
export function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(HouseholdProvider, { householdId: 'h1' }, children),
    )
}
