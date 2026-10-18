import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMemberAllowance } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useMemberAllowances, type MemberAllowanceInput } from './useMemberAllowances'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder), rpc } }))

const input: MemberAllowanceInput = {
  amount_cents: 200_00,
  frequency: 'fortnightly',
  interval_count: null,
  destination_account_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeMemberAllowance()], error: null }
  rpc.mockResolvedValue({ data: [], error: null })
})

describe('useMemberAllowances', () => {
  it('exposes the household allowances and its edit', async () => {
    const { result } = renderHook(() => useMemberAllowances(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.allowances).toEqual([makeMemberAllowance()]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.update('al1', input)
      await result.current.reload()
    })

    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.insert).not.toHaveBeenCalled()
    expect(builder.delete).not.toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'al1')
  })

  it('attaches the drawn total of a co-member’s allowance, and leaves one with none readable alone', async () => {
    builder.result = {
      data: [makeMemberAllowance(), makeMemberAllowance({ id: 'al2', member_id: 'm2' })],
      error: null,
    }
    rpc.mockResolvedValue({
      data: [{ member_id: 'm2', drawn_fortnightly_cents: 60_00, drawn_annual_cents: 1_560_00 }],
      error: null,
    })
    const { result } = renderHook(() => useMemberAllowances(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.allowances).toHaveLength(2))

    expect(rpc).toHaveBeenCalledWith('hidden_allowance_drawn')
    expect(result.current.allowances![0]).toEqual(makeMemberAllowance())
    expect(result.current.allowances![1]).toMatchObject({
      member_id: 'm2',
      drawn_fortnightly_cents: 60_00,
      drawn_annual_cents: 1_560_00,
    })
  })
})
