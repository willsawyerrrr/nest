import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useCalendarFeed } from './useCalendarFeed'

const { builder, rpc } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'maybeSingle']),
    rpc: vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(() => builder), rpc },
}))

const activeFeed = { household_id: 'h1', created_at: '2027-01-01T00:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: null, error: null }
  rpc.mockResolvedValue({ data: 'a'.repeat(64), error: null })
})

describe('useCalendarFeed', () => {
  it('reports no active feed when none exists', async () => {
    const { result } = renderHook(() => useCalendarFeed(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.status).toBeNull()
  })

  it('loads the household feed row on mount', async () => {
    builder.result = { data: activeFeed, error: null }
    const { result } = renderHook(() => useCalendarFeed(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.status).toEqual(activeFeed)
  })

  it('mints a token via the RPC, returns it, and refetches', async () => {
    const { result } = renderHook(() => useCalendarFeed(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: activeFeed, error: null }
    let token: string | undefined
    await act(async () => {
      token = await result.current.create()
    })

    expect(rpc).toHaveBeenCalledWith('create_calendar_feed_token')
    expect(token).toBe('a'.repeat(64))
    await waitFor(() => expect(result.current.status).toEqual(activeFeed))
  })

  it('revokes the token via the RPC and refetches', async () => {
    builder.result = { data: activeFeed, error: null }
    const { result } = renderHook(() => useCalendarFeed(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toEqual(activeFeed))

    builder.result = { data: null, error: null }
    await act(async () => {
      await result.current.revoke()
    })

    expect(rpc).toHaveBeenCalledWith('revoke_calendar_feed_token')
    await waitFor(() => expect(result.current.status).toBeNull())
  })

  it('leaves the status null when the load fails', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useCalendarFeed(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.status).toBeNull()
  })

  it('propagates create and revoke errors', async () => {
    const { result } = renderHook(() => useCalendarFeed(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rpc.mockResolvedValueOnce({ data: null, error: new Error('create failed') })
    await expect(result.current.create()).rejects.toThrow('create failed')

    rpc.mockResolvedValueOnce({ error: new Error('revoke failed') })
    await expect(result.current.revoke()).rejects.toThrow('revoke failed')
  })
})
