import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useSuperContributions, type SuperContributionInput } from './useSuperContributions'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: SuperContributionInput = {
  member_id: 'm1',
  kind: 'salary_sacrifice',
  mode: 'amount',
  amount_cents: 500_00,
  percent_bp: null,
  frequency: 'fortnightly',
  interval_count: null,
  fhss_eligible: false,
  contributor_member_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'sc1' }], error: null }
})

describe('useSuperContributions', () => {
  it('exposes the household super contributions for the financial year', async () => {
    const { result } = renderHook(() => useSuperContributions(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.contributions).toEqual([{ id: 'sc1' }]))
    expect(result.current.loading).toBe(false)
    expect(result.current.financialYear).toBeGreaterThan(2000)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('sc1', input)
      await result.current.remove('sc1')
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
    expect(builder.eq).toHaveBeenCalledWith('id', 'sc1')
  })

  it('scopes to an explicit financial year when given one', async () => {
    const { result } = renderHook(() => useSuperContributions(2025), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.contributions).toEqual([{ id: 'sc1' }]))
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
