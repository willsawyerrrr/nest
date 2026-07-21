import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBudgetLine } from '../test/fixtures'
import { useBudgetLines } from './useBudgetLines'

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
  builder.result = { data: [makeBudgetLine({ id: 'b1' })], error: null }
})

describe('useBudgetLines', () => {
  it('exposes the household budget lines and its mutations', async () => {
    const { result } = renderHook(() => useBudgetLines('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.lines).not.toBeNull())
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create({} as never)
      await result.current.update('b1', {} as never)
      await result.current.remove('b1')
      await result.current.reload()
    })
  })
})
