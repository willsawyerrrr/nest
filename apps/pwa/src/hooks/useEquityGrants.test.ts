import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useEquityGrants, type EquityGrantInput } from './useEquityGrants'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: EquityGrantInput = {
  member_id: 'm1',
  label: 'ISO grant',
  instrument_type: 'option',
  quantity: 1000,
  grant_date: '2026-01-01',
  cliff_months: 12,
  vesting_period_months: 48,
  vesting_frequency: 'monthly',
  strike_price_cents: 1_00,
  price_per_share_cents: 5_00,
  price_as_of: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'eg1' }], error: null }
})

describe('useEquityGrants', () => {
  it('exposes the household equity grants and mutates them', async () => {
    const { result } = renderHook(() => useEquityGrants(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.grants).toEqual([{ id: 'eg1' }]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('eg1', input)
      await result.current.remove('eg1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'eg1')
  })
})
