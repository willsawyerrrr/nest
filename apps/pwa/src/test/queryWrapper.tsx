import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Build a `renderHook` wrapper providing a fresh React Query client with
 * retries disabled, so a query's error surfaces on the first attempt rather
 * than being retried under test.
 */
export function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}
