import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useEquitySales, type EquitySaleInput } from './useEquitySales'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: EquitySaleInput = {
  member_id: 'm1',
  grant_id: 'eg1',
  sold_on: '2026-06-01',
  quantity: 50,
  price_per_share_cents: 5_00,
  fee_cents: 10_00,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'sl1' }], error: null }
})

describe('useEquitySales', () => {
  it('exposes the household equity sales and mutates them', async () => {
    const { result } = renderHook(() => useEquitySales(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.sales).toEqual([{ id: 'sl1' }]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('sl1', input)
      await result.current.remove('sl1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'sl1')
  })
})
