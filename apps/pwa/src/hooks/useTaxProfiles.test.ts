import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useTaxProfiles } from './useTaxProfiles'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'upsert', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'tp1' }], error: null }
})

describe('useTaxProfiles', () => {
  it('exposes the household tax profiles and upserts one', async () => {
    const { result } = renderHook(() => useTaxProfiles('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.profiles).toEqual([{ id: 'tp1' }]))
    expect(result.current.loading).toBe(false)
    expect(result.current.financialYear).toBeGreaterThan(2000)

    await act(async () => {
      await result.current.upsert({} as never)
      await result.current.reload()
    })
    expect(builder.upsert).toHaveBeenCalled()
  })
})
