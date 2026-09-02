import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAccountDirectoryEntry } from '../test/fixtures'
import { useAccountDirectory } from './useAccountDirectory'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeAccountDirectoryEntry()], error: null }
})

describe('useAccountDirectory', () => {
  it('loads account identity from the directory view on mount', async () => {
    const { result } = renderHook(() => useAccountDirectory())
    await waitFor(() => expect(result.current.accounts).toEqual([makeAccountDirectoryEntry()]))
    expect(result.current.loading).toBe(false)
    expect(builder.select).toHaveBeenCalledWith(
      'id,name,type,source,owner_member_id,deleted_from_source_at',
    )
  })

  it('propagates a load error', async () => {
    const { result } = renderHook(() => useAccountDirectory())
    await waitFor(() => expect(result.current.loading).toBe(false))
    builder.result = { data: null, error: new Error('load failed') }
    await expect(result.current.reload()).rejects.toThrow('load failed')
  })
})
