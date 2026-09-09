import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useDeductionGroups, type DeductionGroupInput } from './useDeductionGroups'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']),
  }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: DeductionGroupInput = { member_id: 'm1', name: 'Adobe Creative Cloud' }

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'g1' }], error: null }
})

describe('useDeductionGroups', () => {
  it('exposes the household groups for the financial year and mutates them', async () => {
    const { result } = renderHook(() => useDeductionGroups(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.groups).toEqual([{ id: 'g1' }]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('g1', input)
      await result.current.remove('g1')
      await result.current.reload()
    })

    // A group is scoped to a financial year exactly as a deduction is, so the
    // year is both the filter and the default written on insert.
    expect(builder.eq).toHaveBeenCalledWith('financial_year', expect.any(Number))
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'g1')
  })

  it('scopes to an explicit financial year when given one', async () => {
    const { result } = renderHook(() => useDeductionGroups(2025), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.groups).toEqual([{ id: 'g1' }]))

    await act(async () => {
      await result.current.create(input)
    })

    expect(builder.eq).toHaveBeenCalledWith('financial_year', 2025)
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ ...input, household_id: 'h1', financial_year: 2025 }),
    )
  })
})
