import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { useCurrentMember } from './useCurrentMember'

const { builder, getUser } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'order']), getUser: vi.fn() }
})

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(() => builder), auth: { getUser } },
}))

const alice = makeMember({ id: 'm-alice', user_id: 'u-alice', name: 'Alice' })
const bob = makeMember({ id: 'm-bob', user_id: 'u-bob', name: 'Bob' })

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [alice, bob], error: null }
  getUser.mockResolvedValue({ data: { user: { id: 'u-bob' } }, error: null })
})

describe('useCurrentMember', () => {
  it('resolves the member matching the authenticated user', async () => {
    const { result } = renderHook(() => useCurrentMember())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.member).toEqual(bob)
  })

  it('returns no member when none matches the authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-carol' } }, error: null })
    const { result } = renderHook(() => useCurrentMember())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.member).toBeNull()
  })

  it('returns no member when there is no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { result } = renderHook(() => useCurrentMember())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.member).toBeNull()
  })
})
