import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { useMembers } from './useMembers'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'update', 'eq', 'order']) }
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

  it('records a member’s date of birth and reloads them', async () => {
    const { result } = renderHook(() => useMembers())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.setDateOfBirth('m1', '1990-01-01'))

    expect(builder.update).toHaveBeenCalledWith({ date_of_birth: '1990-01-01' })
    expect(builder.eq).toHaveBeenCalledWith('id', 'm1')
    // The reload after the write is what puts the new value in front of the form.
    expect(builder.select).toHaveBeenCalledTimes(2)
  })

  it('clears a member’s date of birth', async () => {
    const { result } = renderHook(() => useMembers())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.setDateOfBirth('m1', null))
    expect(builder.update).toHaveBeenCalledWith({ date_of_birth: null })
  })

  it('propagates a write error', async () => {
    const { result } = renderHook(() => useMembers())
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: null, error: new Error('write failed') }
    await expect(result.current.setDateOfBirth('m1', null)).rejects.toThrow('write failed')
  })
})
