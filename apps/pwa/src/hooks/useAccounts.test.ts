import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HouseholdProvider } from '../components/HouseholdProvider'
import { makeSaver } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useAccounts } from './useAccounts'
import { useSavers } from './useSavers'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder([
      'select',
      'insert',
      'update',
      'delete',
      'upsert',
      'eq',
      'neq',
      'order',
      'single',
    ]),
  }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeSaver()], error: null }
})

describe('useAccounts', () => {
  it('loads the household accounts on mount', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
    expect(result.current.accounts).toBeNull()
    await waitFor(() => expect(result.current.accounts).toEqual([makeSaver()]))
    expect(result.current.loading).toBe(false)
  })

  it('inserts a manual account and returns its id, then updates one', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: { id: 'newacc' }, error: null }
    let inserted = ''
    await act(async () => {
      inserted = await result.current.insert({
        source: 'manual',
        type: 'savings',
        owner_member_id: 'm1',
        name: 'Will Super',
      })
    })
    expect(inserted).toBe('newacc')
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Will Super', household_id: 'h1' }),
    )

    builder.result = { data: [makeSaver()], error: null }
    await act(async () => {
      await result.current.update('a1', { name: 'Renamed' })
    })
    expect(builder.update).toHaveBeenCalledWith({ name: 'Renamed' })
    expect(builder.eq).toHaveBeenCalledWith('id', 'a1')
  })

  it('upserts a balance into account_balance keyed on the account id', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: null, error: null }
    await act(async () => {
      await result.current.upsertBalance('a1', 1234)
    })
    expect(builder.upsert).toHaveBeenCalledWith(
      { account_id: 'a1', household_id: 'h1', balance_cents: 1234 },
      { onConflict: 'account_id' },
    )
  })

  it('removes an account by id', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: null, error: null }
    await act(async () => {
      await result.current.remove('a1')
    })
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'a1')
  })

  it('leaves accounts null when the load fails', async () => {
    builder.result = { data: null, error: new Error('boom') }
    const { result } = renderHook(() => useAccounts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.accounts).toBeNull()
  })

  it('propagates reload, insert, update, remove, and balance errors', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: null, error: new Error('boom') }
    await expect(
      result.current.insert({ source: 'manual', type: 'savings', name: 'x' }),
    ).rejects.toThrow('boom')
    await expect(result.current.update('a1', {})).rejects.toThrow('boom')
    await expect(result.current.remove('a1')).rejects.toThrow('boom')
    await expect(result.current.upsertBalance('a1', 0)).rejects.toThrow('boom')
    // `reload` invalidates the cache; the failing refetch is swallowed by React
    // Query, so the call resolves and the stale rows stay in place.
    await act(async () => {
      await result.current.reload()
    })
  })

  it('refetches a co-mounted useSavers and the directory when a balance is written', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(HouseholdProvider, { householdId: 'h1' }, children),
      )

    const { result } = renderHook(() => ({ accounts: useAccounts(), savers: useSavers() }), {
      wrapper,
    })
    await waitFor(() => {
      expect(result.current.accounts.loading).toBe(false)
      expect(result.current.savers.loading).toBe(false)
    })

    invalidateSpy.mockClear()
    builder.select.mockClear()
    builder.result = { data: [makeSaver({ balance_cents: 999 })], error: null }
    await act(async () => {
      await result.current.accounts.upsertBalance('a1', 999)
    })

    // The write invalidates both account views; the savers slice sharing the
    // `accounts_with_balance` prefix reloads without being remounted.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts_with_balance', 'h1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['account_directory', 'h1'] })
    expect(builder.select).toHaveBeenCalled()
    await waitFor(() =>
      expect(result.current.savers.savers).toEqual([makeSaver({ balance_cents: 999 })]),
    )
  })
})
