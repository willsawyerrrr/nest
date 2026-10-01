import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useTrades, type TradeInput } from './useTrades'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: TradeInput = {
  member_id: 'm1',
  ticker: 'VAS',
  side: 'buy',
  traded_on: '2026-01-01',
  units: 10,
  price_per_unit_microdollars: 90_000_000,
  fee_cents: 9_50,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 't1' }], error: null }
})

describe('useTrades', () => {
  it('exposes the household trades and mutates them', async () => {
    const { result } = renderHook(() => useTrades(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.trades).toEqual([{ id: 't1' }]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('t1', input)
      await result.current.remove('t1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 't1')
    expect(builder.order).toHaveBeenCalledWith('traded_on', { ascending: true })
  })
})
