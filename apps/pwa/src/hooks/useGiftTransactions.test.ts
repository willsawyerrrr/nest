import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HouseholdProvider } from '../components/HouseholdProvider'
import { makeWrapper } from '../test/queryWrapper'
import { useGiftTransactions } from './useGiftTransactions'

const { builder, from } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  const builder = makeSupabaseBuilder(['select', 'insert', 'delete', 'eq', 'order'])
  return { builder, from: vi.fn((_table: string) => builder) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
})

describe('useGiftTransactions', () => {
  it('loads the gift-category transactions newest first, alongside the dismissals', async () => {
    const { result } = renderHook(() => useGiftTransactions(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(from).toHaveBeenCalledWith('transactions')
    expect(from).toHaveBeenCalledWith('gift_transaction_dismissal')
    expect(builder.eq).toHaveBeenCalledWith('external_category', 'gifts-and-charity')
    expect(builder.order).toHaveBeenCalledWith('posted_at', { ascending: false })
    expect(result.current.transactions).toEqual([])
    expect(result.current.dismissals).toEqual([])
  })

  it('reports loading while either collection is unresolved', () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useGiftTransactions(), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
  })

  it('dismisses a candidate as its own household-scoped row', async () => {
    const { result } = renderHook(() => useGiftTransactions(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.dismiss('t1'))

    expect(builder.insert).toHaveBeenCalledWith({ transaction_id: 't1', household_id: 'h1' })
  })

  it('undoes a dismissal by deleting it', async () => {
    const { result } = renderHook(() => useGiftTransactions(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.restore('d1'))

    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'd1')
  })

  it('reloads both collections together', async () => {
    const { result } = renderHook(() => useGiftTransactions(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    const before = from.mock.calls.length
    await act(() => result.current.reload())
    expect(from.mock.calls.length).toBeGreaterThan(before + 1)
  })

  it('refreshes the inbox when a dismissal is written', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(HouseholdProvider, { householdId: 'h1' }, children),
      )
    const { result } = renderHook(() => useGiftTransactions(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Setting a candidate aside takes it out of the inbox, so the transactions
    // cache is invalidated alongside the dismissals themselves.
    invalidateSpy.mockClear()
    await act(() => result.current.dismiss('t1'))
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['gift_transaction_dismissal', 'h1'],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions', 'h1'] })
  })
})
