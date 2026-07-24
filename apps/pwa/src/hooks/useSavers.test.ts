import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSaver } from '../test/fixtures'
import { useSavers } from './useSavers'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeSaver()], error: null }
})

describe('useSavers', () => {
  it('loads the synced Up savers on mount', async () => {
    const { result } = renderHook(() => useSavers())
    await waitFor(() => expect(result.current.savers).toEqual([makeSaver()]))
    expect(result.current.loading).toBe(false)
    expect(builder.eq).toHaveBeenCalledWith('source', 'up')
    expect(builder.eq).toHaveBeenCalledWith('type', 'savings')
  })

  it('propagates a load error', async () => {
    const { result } = renderHook(() => useSavers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    builder.result = { data: null, error: new Error('load failed') }
    await expect(result.current.reload()).rejects.toThrow('load failed')
  })
})
