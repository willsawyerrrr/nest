import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { usePaySplits } from './usePaySplits'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'upsert', 'delete', 'eq']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = {
    data: [{ account_id: 'a1', confirmed_fortnightly_cents: 12345 }],
    error: null,
  }
})

describe('usePaySplits', () => {
  it('loads and indexes the confirmed split per account', async () => {
    const { result } = renderHook(() => usePaySplits(), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
    expect(result.current.configuredByAccount.size).toBe(0)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.configuredByAccount.get('a1')).toBe(12345)
  })

  it('confirms a split, reloading afterwards', async () => {
    const { result } = renderHook(() => usePaySplits(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.select.mockClear()
    await act(async () => {
      await result.current.confirm('a2', 6789)
    })
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        account_id: 'a2',
        confirmed_fortnightly_cents: 6789,
      }),
      { onConflict: 'household_id,account_id' },
    )
    await waitFor(() => expect(builder.select).toHaveBeenCalled())
  })

  it('clears a split, reloading afterwards', async () => {
    const { result } = renderHook(() => usePaySplits(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.clear('a1')
    })
    expect(builder.delete).toHaveBeenCalledTimes(1)
    expect(builder.eq).toHaveBeenCalledWith('account_id', 'a1')
  })

  it('leaves the split index empty when the load fails', async () => {
    builder.result = { data: null, error: new Error('boom') }
    const { result } = renderHook(() => usePaySplits(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.configuredByAccount.size).toBe(0)
  })

  it('propagates confirm and clear errors', async () => {
    const { result } = renderHook(() => usePaySplits(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    builder.result = { data: null, error: new Error('boom') }
    await expect(result.current.confirm('a2', 1)).rejects.toThrow('boom')
    await expect(result.current.clear('a2')).rejects.toThrow('boom')
  })
})
