import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBreakdowns } from './useBreakdowns'

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
  builder.result = { data: [], error: null }
})

describe('useBreakdowns', () => {
  it('loads breakdowns alongside items and runs each mutation with an item reload', async () => {
    const { result } = renderHook(() => useBreakdowns('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.breakdowns).toEqual([])
    expect(result.current.items).toEqual([])

    await act(async () => {
      await result.current.reload()
      await result.current.create({ name: 'Meds', line_group: 'needs', kind: 'generic' })
      await result.current.update('bd1', { name: 'Meds', line_group: 'needs' })
      await result.current.remove('bd1')
    })
  })

  it('reports loading while a collection is null', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useBreakdowns('h1'), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
  })
})
