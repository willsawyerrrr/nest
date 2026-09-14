import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HouseholdProvider } from '../components/HouseholdProvider'
import { makeWrapper } from '../test/queryWrapper'
import { useRedbarkConnections } from './useRedbarkConnections'

const LINK_SESSION_STORAGE_KEY = 'redbark-link-session-id'

const { builder, invoke } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'order']),
    invoke: (await import('vitest')).vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(() => builder), functions: { invoke } },
}))

const connection = {
  id: 'c1',
  household_id: 'h1',
  member_id: 'm1',
  institution_name: 'Big Bank',
  status: 'active',
  created_at: '2027-01-01T00:00:00Z',
  updated_at: '2027-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  builder.result = { data: [connection], error: null }
  invoke.mockResolvedValue({ data: null, error: null })
})

describe('useRedbarkConnections', () => {
  it('loads the household connections on mount', async () => {
    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.connections).toEqual([connection]))
  })

  it('leaves connections null when the load fails', async () => {
    builder.result = { data: null, error: new Error('boom') }
    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.connections).toBeNull()
  })

  it('finds no pending link session on a plain mount', async () => {
    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.completeResult).toBeNull()
    expect(invoke).not.toHaveBeenCalledWith('redbark-connect-complete', expect.anything())
  })

  it('connect stores the link session id and navigates to the consent URL', async () => {
    invoke.mockResolvedValue({
      data: { linkSessionId: 'ls1', url: 'https://redbark.example/consent' },
      error: null,
    })
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    })

    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.connect('https://app.example/settings/connections')
    })

    expect(invoke).toHaveBeenCalledWith('redbark-connect', {
      body: { returnUrl: 'https://app.example/settings/connections' },
    })
    expect(sessionStorage.getItem(LINK_SESSION_STORAGE_KEY)).toBe('ls1')
    expect(window.location.href).toBe('https://redbark.example/consent')

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('propagates a connect error without navigating', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('rejected') })
    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.connect('https://app.example')).rejects.toThrow('rejected')
    expect(result.current.busy).toBe(false)
    expect(sessionStorage.getItem(LINK_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('disconnects a connection, then reloads connections and accounts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(HouseholdProvider, { householdId: 'h1' }, children),
      )

    const { result } = renderHook(() => useRedbarkConnections(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.disconnect('c1')
    })

    expect(invoke).toHaveBeenCalledWith('redbark-disconnect', { body: { connectionId: 'c1' } })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['redbark_connection', 'h1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts_with_balance', 'h1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['account_directory', 'h1'] })
  })

  it('propagates a disconnect error', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('rejected') })
    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.disconnect('c1')).rejects.toThrow('rejected')
  })

  it('dismisses the complete result', async () => {
    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.dismissCompleteResult())
    expect(result.current.completeResult).toBeNull()
  })
})

describe('useRedbarkConnections completing a pending link session', () => {
  beforeEach(() => {
    sessionStorage.setItem(LINK_SESSION_STORAGE_KEY, 'ls1')
  })

  it('reports connected, syncs, and clears the stashed link session id', async () => {
    invoke.mockResolvedValue({ data: { connected: true }, error: null })

    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.completeResult).toEqual({ status: 'connected' }))
    expect(invoke).toHaveBeenCalledWith('redbark-connect-complete', {
      body: { linkSessionId: 'ls1' },
    })
    expect(invoke).toHaveBeenCalledWith('redbark-sync', { body: {} })
    expect(sessionStorage.getItem(LINK_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('reports a pending status and clears the stashed link session id', async () => {
    invoke.mockResolvedValue({ data: { connected: false, status: 'pending' }, error: null })

    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.completeResult).toEqual({ status: 'pending' }))
    expect(sessionStorage.getItem(LINK_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('reports a failure with its reason and clears the stashed link session id', async () => {
    invoke.mockResolvedValue({
      data: { connected: false, status: 'failed', reason: 'Consent declined' },
      error: null,
    })

    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })

    await waitFor(() =>
      expect(result.current.completeResult).toEqual({
        status: 'failed',
        reason: 'Consent declined',
      }),
    )
    expect(sessionStorage.getItem(LINK_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('reports a failure when redbark-connect-complete itself errors', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('network error') })

    const { result } = renderHook(() => useRedbarkConnections(), { wrapper: makeWrapper() })

    await waitFor(() =>
      expect(result.current.completeResult).toEqual({
        status: 'failed',
        reason: 'network error',
      }),
    )
    expect(sessionStorage.getItem(LINK_SESSION_STORAGE_KEY)).toBeNull()
  })
})
