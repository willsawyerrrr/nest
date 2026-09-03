import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeGoal } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useGoals, type GoalInput } from './useGoals'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: GoalInput = {
  name: 'Emergency fund',
  target_amount_cents: 10_000_00,
  target_date: null,
  current_balance_cents: 0,
  linked_account_id: null,
  annual_interest_bps: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeGoal()], error: null }
})

describe('useGoals', () => {
  it('exposes the household savings goals and its mutations', async () => {
    const { result } = renderHook(() => useGoals('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.goals).toEqual([makeGoal()]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('g1', input)
      await result.current.remove('g1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'g1')
  })
})
