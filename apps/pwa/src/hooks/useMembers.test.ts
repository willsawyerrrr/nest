import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useMembers } from './useMembers'

const { builder, rpc } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'order']), rpc: vi.fn() }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder), rpc } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeMember()], error: null }
  rpc.mockResolvedValue({ error: null })
})

describe('useMembers', () => {
  it('loads the household members on mount', async () => {
    const { result } = renderHook(() => useMembers(), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
    expect(result.current.members).toBeNull()
    await waitFor(() => expect(result.current.members).toEqual([makeMember()]))
    expect(result.current.loading).toBe(false)
  })

  it('leaves members null when the load fails', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useMembers(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.members).toBeNull()
  })

  it('records a member’s date of birth and refetches them', async () => {
    const { result } = renderHook(() => useMembers(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.select.mockClear()
    await act(() => result.current.setDateOfBirth('m1', '1990-01-01'))

    expect(rpc).toHaveBeenCalledWith('set_member_date_of_birth', {
      p_member_id: 'm1',
      p_date_of_birth: '1990-01-01',
    })
    // The refetch after the write is what puts the new value in front of the form.
    await waitFor(() => expect(builder.select).toHaveBeenCalled())
  })

  it('clears a member’s date of birth', async () => {
    const { result } = renderHook(() => useMembers(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.setDateOfBirth('m1', null))
    expect(rpc).toHaveBeenCalledWith('set_member_date_of_birth', {
      p_member_id: 'm1',
      p_date_of_birth: null,
    })
  })

  it('propagates a write error', async () => {
    const { result } = renderHook(() => useMembers(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rpc.mockResolvedValue({ error: new Error('write failed') })
    await expect(result.current.setDateOfBirth('m1', null)).rejects.toThrow('write failed')
  })
})
