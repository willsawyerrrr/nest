import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHousehold } from './useHousehold'

const { builder, rpcMock, getUser } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'eq', 'order']),
    rpcMock: vi.fn((): Promise<{ data: unknown; error: unknown }> =>
      Promise.resolve({ data: 'h1', error: null }),
    ),
    getUser: vi.fn((): Promise<{ data: { user: { id: string } | null } }> =>
      Promise.resolve({ data: { user: { id: 'u1' } } }),
    ),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(() => builder), rpc: rpcMock, auth: { getUser } },
}))

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children)

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'h1' }], error: null }
  rpcMock.mockResolvedValue({ data: 'h1', error: null })
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('useHousehold', () => {
  it('loads the households on mount for the authed user', async () => {
    const { result } = renderHook(() => useHousehold(), { wrapper })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.households).toEqual([{ id: 'h1' }]))
    expect(result.current.loading).toBe(false)
  })

  it('creates and revokes an invite code, refetching each time', async () => {
    const { result } = renderHook(() => useHousehold(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.createInviteCode()
    })
    expect(rpcMock).toHaveBeenCalledWith('create_invite_code')

    await act(async () => {
      await result.current.revokeInviteCode()
    })
    expect(rpcMock).toHaveBeenCalledWith('revoke_invite_code')
  })

  it('creates and joins a household, invalidating the new household’s budget lines', async () => {
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useHousehold(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Creating the household seeds its member, driving the reconcile trigger, so
    // the returned household's budget_line cache is invalidated.
    invalidateSpy.mockClear()
    await act(async () => {
      await result.current.createHousehold('Home', 'Will')
    })
    expect(rpcMock).toHaveBeenCalledWith('create_household', {
      p_name: 'Home',
      p_member_name: 'Will',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budget_line', 'h1'] })

    // Joining adds a member — the same trigger adds "Gifts for <member>" lines —
    // so the joined household's budget_line cache is invalidated too.
    invalidateSpy.mockClear()
    await act(async () => {
      await result.current.joinHousehold('CODE', 'Will')
    })
    expect(rpcMock).toHaveBeenCalledWith('join_household', {
      p_code: 'CODE',
      p_member_name: 'Will',
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['budget_line', 'h1'] })
  })

  it('leaves the households null when the load fails', async () => {
    builder.result = { data: null, error: new Error('load failed') }
    const { result } = renderHook(() => useHousehold(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.households).toBeNull()
  })

  it('signs a user with no account in as belonging to no household', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    builder.result = { data: [], error: null }
    const { result } = renderHook(() => useHousehold(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.households).toEqual([])
  })

  it('propagates rpc errors', async () => {
    const { result } = renderHook(() => useHousehold(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rpcMock.mockResolvedValue({ data: null, error: new Error('rpc failed') })
    await expect(result.current.createInviteCode()).rejects.toThrow('rpc failed')
    await expect(result.current.revokeInviteCode()).rejects.toThrow('rpc failed')
    await expect(result.current.createHousehold('Home', 'Will')).rejects.toThrow('rpc failed')
    await expect(result.current.joinHousehold('CODE', 'Will')).rejects.toThrow('rpc failed')
  })
})
