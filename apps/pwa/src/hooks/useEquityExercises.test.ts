import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useEquityExercises, type EquityExerciseInput } from './useEquityExercises'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: EquityExerciseInput = {
  member_id: 'm1',
  grant_id: 'eg1',
  exercised_on: '2026-03-01',
  quantity: 100,
  strike_price_cents: 1_00,
  market_price_per_share_cents: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'ex1' }], error: null }
})

describe('useEquityExercises', () => {
  it('exposes the household equity exercises and mutates them', async () => {
    const { result } = renderHook(() => useEquityExercises(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.exercises).toEqual([{ id: 'ex1' }]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('ex1', input)
      await result.current.remove('ex1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'ex1')
  })
})
