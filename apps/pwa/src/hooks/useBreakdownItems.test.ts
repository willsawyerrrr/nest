import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HouseholdProvider } from '../components/HouseholdProvider'
import { makeWrapper } from '../test/queryWrapper'
import { useBreakdownItems } from './useBreakdownItems'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'x' }], error: null }
})

describe('useBreakdownItems', () => {
  it('exposes one breakdown’s items and its mutations', async () => {
    const { result } = renderHook(() => useBreakdownItems('bd1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'x' }]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create({} as never)
      await result.current.update('x', {} as never)
      await result.current.remove('x')
      await result.current.reload()
    })
    expect(builder.eq).toHaveBeenCalledWith('breakdown_id', 'bd1')
  })

  it('invalidates the budget_line cache so the trigger-updated line refetches', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(HouseholdProvider, { householdId: 'h1' }, children),
      )
    const { result } = renderHook(() => useBreakdownItems('bd1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Deleting an item drives the reconcile trigger, so the raw budget lines the
    // Pay splits tab reads are invalidated and refetch.
    invalidateSpy.mockClear()
    await act(async () => {
      await result.current.remove('x')
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budget_line', 'h1'] })
  })
})
