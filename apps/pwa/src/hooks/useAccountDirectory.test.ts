import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAccountDirectoryEntry } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
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
    const { result } = renderHook(() => useAccountDirectory(), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
    expect(result.current.accounts).toBeNull()
    await waitFor(() => expect(result.current.accounts).toEqual([makeAccountDirectoryEntry()]))
    expect(result.current.loading).toBe(false)
    expect(builder.select).toHaveBeenCalledWith(
      'id,name,type,source,owner_member_id,deleted_from_source_at',
    )
  })

  it('leaves accounts null when the load fails', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useAccountDirectory(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.accounts).toBeNull()
  })

  it('reload refetches the directory view', async () => {
    const { result } = renderHook(() => useAccountDirectory(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.select.mockClear()
    await result.current.reload()
    await waitFor(() => expect(builder.select).toHaveBeenCalled())
  })
})
