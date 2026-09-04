import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeGoal } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { goalInputFromRow, useGoals, type GoalInput } from './useGoals'

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
  queue_position: null,
  planned_contribution_cents: null,
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

  it('writes a new queue_position only for the goals a reorder moved', async () => {
    builder.result = {
      data: [
        makeGoal({ id: 'g1', name: 'A', queue_position: 0 }),
        makeGoal({ id: 'g2', name: 'B', queue_position: 1 }),
      ],
      error: null,
    }
    const { result } = renderHook(() => useGoals('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.goals).toHaveLength(2))

    await act(async () => {
      await result.current.reorderQueue(['g2', 'g1'])
    })

    // g2 moves from 1 → 0 and g1 from 0 → 1; both are written, nothing else.
    expect(builder.update).toHaveBeenCalledTimes(2)
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ queue_position: 0 }))
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ queue_position: 1 }))
  })

  it('writes nothing when a reorder leaves every goal where it was', async () => {
    builder.result = {
      data: [
        makeGoal({ id: 'g1', name: 'A', queue_position: 0 }),
        makeGoal({ id: 'g2', name: 'B', queue_position: 1 }),
      ],
      error: null,
    }
    const { result } = renderHook(() => useGoals('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.goals).toHaveLength(2))

    await act(async () => {
      // g1 and g2 keep their positions; an id no longer in the queue is skipped.
      await result.current.reorderQueue(['g1', 'g2', 'gone'])
    })

    expect(builder.update).not.toHaveBeenCalled()
  })
})

describe('goalInputFromRow', () => {
  it('maps a row to a complete input and applies the patch', () => {
    const row = makeGoal({ id: 'g1', name: 'Boat', queue_position: 3 })
    expect(goalInputFromRow(row, { queue_position: 0 })).toEqual({
      name: 'Boat',
      target_amount_cents: row.target_amount_cents,
      target_date: null,
      current_balance_cents: 0,
      linked_account_id: null,
      annual_interest_bps: null,
      queue_position: 0,
      planned_contribution_cents: null,
    })
  })
})
