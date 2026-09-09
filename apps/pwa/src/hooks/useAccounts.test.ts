import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSaver } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useAccounts } from './useAccounts'

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

  it('propagates load, insert, update, and balance errors', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: null, error: new Error('boom') }
    await expect(result.current.reload()).rejects.toThrow('boom')
    await expect(
      result.current.insert({
        source: 'manual',
        type: 'savings',
        name: 'x',
      }),
    ).rejects.toThrow('boom')
    await expect(result.current.update('a1', {})).rejects.toThrow('boom')
    await expect(result.current.remove('a1')).rejects.toThrow('boom')
    await expect(result.current.upsertBalance('a1', 0)).rejects.toThrow('boom')
  })
})
