import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { salaryCreditBounds } from '../lib/netPay'
import { makeWrapper } from '../test/queryWrapper'
import { useSalaryCredits } from './useSalaryCredits'

const { builder, from } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  const builder = makeSupabaseBuilder(['select', 'eq', 'gt', 'gte', 'lt', 'order'])
  return { builder, from: vi.fn((_table: string) => builder) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [], error: null }
})

describe('useSalaryCredits', () => {
  it('reads the positive income credits around the year', async () => {
    const row = {
      id: 't1',
      posted_at: '2026-07-15T09:00:00+10:00',
      amount_cents: 4_000_00,
      member_id: null,
      description: 'Acme',
      transaction_type: 'Salary',
    }
    builder.result = { data: [row], error: null }
    const { result } = renderHook(() => useSalaryCredits(2027), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    const { from: start, to: end } = salaryCreditBounds(2027)
    expect(from).toHaveBeenCalledWith('transactions')
    expect(builder.eq).toHaveBeenCalledWith('kind', 'income')
    expect(builder.gt).toHaveBeenCalledWith('amount_cents', 0)
    expect(builder.gte).toHaveBeenCalledWith('posted_at', start)
    expect(builder.lt).toHaveBeenCalledWith('posted_at', end)
    expect(result.current.credits).toEqual([row])
  })

  it('stays unloaded when the read fails', async () => {
    builder.result = { data: null, error: new Error('boom') }
    const { result } = renderHook(() => useSalaryCredits(2027), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.credits).toBeNull()
  })
})
