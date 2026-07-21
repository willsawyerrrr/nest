import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHousehold } from './useHousehold'

const { builder, rpcMock } = vi.hoisted(() => {
  const b: Record<string, unknown> & { result: { data: unknown; error: unknown } } = {
    result: { data: [], error: null },
  } as never
  for (const method of ['select', 'eq', 'order']) {
    b[method] = vi.fn(() => b)
  }
  b.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(b.result).then(onFulfilled, onRejected)
  return {
    builder: b,
    rpcMock: vi.fn((): Promise<{ error: unknown }> => Promise.resolve({ error: null })),
  }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder), rpc: rpcMock } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [{ id: 'h1' }], error: null }
  rpcMock.mockResolvedValue({ error: null })
})

describe('useHousehold', () => {
  it('loads the households on mount', async () => {
    const { result } = renderHook(() => useHousehold())
    await waitFor(() => expect(result.current.households).toEqual([{ id: 'h1' }]))
    expect(result.current.loading).toBe(false)
  })

  it('creates and revokes an invite code, reloading each time', async () => {
    const { result } = renderHook(() => useHousehold())
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

  it('propagates load and rpc errors', async () => {
    const { result } = renderHook(() => useHousehold())
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: null, error: new Error('load failed') }
    await expect(result.current.reload()).rejects.toThrow('load failed')

    rpcMock.mockResolvedValue({ error: new Error('rpc failed') })
    await expect(result.current.createInviteCode()).rejects.toThrow('rpc failed')
    await expect(result.current.revokeInviteCode()).rejects.toThrow('rpc failed')
  })
})
