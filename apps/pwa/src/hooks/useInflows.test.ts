import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeInflow } from '../test/fixtures'
import { useInflows } from './useInflows'

const { builder } = vi.hoisted(() => {
  const b: Record<string, unknown> & { result: { data: unknown; error: unknown } } = {
    result: { data: [], error: null },
  } as never
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
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
  builder.result = { data: [makeInflow()], error: null }
})

describe('useInflows', () => {
  it('exposes the household inflows and its mutations', async () => {
    const { result } = renderHook(() => useInflows('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.inflows).toEqual([makeInflow()]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create({} as never)
      await result.current.update('i1', {} as never)
      await result.current.remove('i1')
      await result.current.reload()
    })
  })
})
