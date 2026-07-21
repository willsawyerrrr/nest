import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAccountDirectoryEntry } from '../test/fixtures'
import { useAccountDirectory } from './useAccountDirectory'

const { builder } = vi.hoisted(() => {
  const b: Record<string, unknown> & { result: { data: unknown; error: unknown } } = {
    result: { data: [], error: null },
  } as never
  for (const method of ['select', 'order']) {
    b[method] = vi.fn(() => b)
  }
  b.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(b.result).then(onFulfilled, onRejected)
  return { builder: b }
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
    expect(builder.select).toHaveBeenCalledWith('id,name,type,source,owner_member_id')
  })

  it('propagates a load error', async () => {
    const { result } = renderHook(() => useAccountDirectory())
    await waitFor(() => expect(result.current.loading).toBe(false))
    builder.result = { data: null, error: new Error('load failed') }
    await expect(result.current.reload()).rejects.toThrow('load failed')
  })
})
