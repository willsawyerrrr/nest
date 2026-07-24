import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { useMembers } from './useMembers'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeMember()], error: null }
})

describe('useMembers', () => {
  it('loads the household members on mount', async () => {
    const { result } = renderHook(() => useMembers())
    await waitFor(() => expect(result.current.members).toEqual([makeMember()]))
    expect(result.current.loading).toBe(false)
  })

  it('propagates a load error', async () => {
    const { result } = renderHook(() => useMembers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    builder.result = { data: null, error: new Error('load failed') }
    await expect(result.current.reload()).rejects.toThrow('load failed')
  })
})
