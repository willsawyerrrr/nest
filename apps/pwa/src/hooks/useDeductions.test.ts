import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useDeductions, type DeductionInput } from './useDeductions'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: DeductionInput = {
  member_id: 'm1',
  description: 'Home office',
  amount_cents: 300_00,
  deduction_date: '2026-09-01',
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'd1' }], error: null }
})

describe('useDeductions', () => {
  it('exposes the household deductions for the financial year and mutates them', async () => {
    const { result } = renderHook(() => useDeductions('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.deductions).toEqual([{ id: 'd1' }]))
    expect(result.current.loading).toBe(false)
    expect(result.current.financialYear).toBeGreaterThan(2000)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('d1', input)
      await result.current.remove('d1')
      await result.current.reload()
    })

    // The load and every insert are scoped to the current financial year.
    expect(builder.eq).toHaveBeenCalledWith('financial_year', result.current.financialYear)
    expect(builder.insert).toHaveBeenCalledWith({
      ...input,
      financial_year: result.current.financialYear,
      household_id: 'h1',
    })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'd1')
  })

  it('scopes to an explicit financial year when given one', async () => {
    const { result } = renderHook(() => useDeductions('h1', 2025), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.deductions).toEqual([{ id: 'd1' }]))
    expect(result.current.financialYear).toBe(2025)

    await act(async () => {
      await result.current.create(input)
    })

    expect(builder.eq).toHaveBeenCalledWith('financial_year', 2025)
    expect(builder.insert).toHaveBeenCalledWith({
      ...input,
      financial_year: 2025,
      household_id: 'h1',
    })
  })
})
