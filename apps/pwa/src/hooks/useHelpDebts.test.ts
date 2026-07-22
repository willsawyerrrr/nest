import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHelpDebts } from './useHelpDebts'

const { builder } = vi.hoisted(() => {
  const b: Record<string, unknown> & { result: { data: unknown; error: unknown } } = {
    result: { data: [], error: null },
  } as never
  for (const method of ['select', 'upsert', 'eq', 'order']) {
    b[method] = vi.fn(() => b)
  }
  b.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(b.result).then(onFulfilled, onRejected)
  return { builder: b }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'hd1', member_id: 'm1', balance_cents: 30_000_00 }], error: null }
})

describe('useHelpDebts', () => {
  it('exposes the household HELP debts and upserts one', async () => {
    const { result } = renderHook(() => useHelpDebts('h1'), { wrapper: makeWrapper() })
    await waitFor(() =>
      expect(result.current.helpDebts).toEqual([
        { id: 'hd1', member_id: 'm1', balance_cents: 30_000_00 },
      ]),
    )
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.upsert({ member_id: 'm1', balance_cents: 40_000_00 })
      await result.current.reload()
    })
    expect(builder.upsert).toHaveBeenCalled()
  })
})
