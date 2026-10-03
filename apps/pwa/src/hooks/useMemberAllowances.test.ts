import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMemberAllowance } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useMemberAllowances, type MemberAllowanceInput } from './useMemberAllowances'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: MemberAllowanceInput = {
  member_id: 'm1',
  amount_cents: 200_00,
  frequency: 'fortnightly',
  interval_count: null,
  destination_account_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeMemberAllowance()], error: null }
})

describe('useMemberAllowances', () => {
  it('exposes the household allowances and its mutations', async () => {
    const { result } = renderHook(() => useMemberAllowances(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.allowances).toEqual([makeMemberAllowance()]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('al1', input)
      await result.current.remove('al1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'al1')
  })
})
