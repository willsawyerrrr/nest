import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useSuperProfiles } from './useSuperProfiles'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'upsert', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'sp1' }], error: null }
})

describe('useSuperProfiles', () => {
  it('exposes the household super profiles and upserts one', async () => {
    const { result } = renderHook(() => useSuperProfiles(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.profiles).toEqual([{ id: 'sp1' }]))
    expect(result.current.loading).toBe(false)
    expect(result.current.financialYear).toBeGreaterThan(2000)

    await act(async () => {
      await result.current.upsert({} as never)
      await result.current.reload()
    })
    expect(builder.upsert).toHaveBeenCalled()
  })

  it('scopes to an explicit financial year when given one', async () => {
    const { result } = renderHook(() => useSuperProfiles(2025), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.profiles).toEqual([{ id: 'sp1' }]))
    expect(result.current.financialYear).toBe(2025)

    await act(async () => {
      await result.current.upsert({} as never)
    })

    expect(builder.eq).toHaveBeenCalledWith('financial_year', 2025)
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ financial_year: 2025, household_id: 'h1' }),
      { onConflict: 'member_id,financial_year' },
    )
  })
})
