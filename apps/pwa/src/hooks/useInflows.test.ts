import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeInflow } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useInflows, type InflowInput } from './useInflows'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: InflowInput = {
  name: 'Salary',
  taxable: true,
  attracts_super: true,
  member_id: 'm1',
  type: 'salary',
  schedule: 'fortnightly',
  interval_count: null,
  pay_schedule: null,
  pay_interval_count: null,
  arrives_every_pay_period: true,
  amount_cents: 5_000_00,
  hourly_rate_cents: null,
  hours_per_period: null,
  starts_on: null,
  ends_on: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeInflow()], error: null }
})

describe('useInflows', () => {
  it('exposes the household inflows and its mutations', async () => {
    const { result } = renderHook(() => useInflows('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.inflows).toEqual([makeInflow()]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('i1', input)
      await result.current.remove('i1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'i1')
  })
})
