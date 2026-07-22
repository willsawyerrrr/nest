import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEquityGrants } from './useEquityGrants'

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
  builder.result = { data: [{ id: 'eg1' }], error: null }
})

describe('useEquityGrants', () => {
  it('exposes the household equity grants and mutates them', async () => {
    const { result } = renderHook(() => useEquityGrants('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.grants).toEqual([{ id: 'eg1' }]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create({} as never)
      await result.current.update('eg1', {} as never)
      await result.current.remove('eg1')
      await result.current.reload()
    })
    expect(builder.insert).toHaveBeenCalled()
    expect(builder.update).toHaveBeenCalled()
    expect(builder.delete).toHaveBeenCalled()
  })
})
