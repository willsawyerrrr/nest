import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBudgetLine } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useBudgetLines, type BudgetLineInput } from './useBudgetLines'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: BudgetLineInput = {
  line_group: 'needs',
  name: 'Rent',
  amount_cents: 2_000_00,
  frequency: 'fortnightly',
  interval_count: null,
  goal_id: null,
  breakdown_id: null,
  destination_account_id: null,
  gift_recipient_member_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeBudgetLine({ id: 'b1' })], error: null }
})

describe('useBudgetLines', () => {
  it('exposes the household budget lines and its mutations', async () => {
    const { result } = renderHook(() => useBudgetLines('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.lines).not.toBeNull())
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('b1', input)
      await result.current.remove('b1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'b1')
  })
})
