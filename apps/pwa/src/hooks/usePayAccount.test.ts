import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { usePayAccount } from './usePayAccount'

const { builder, rpcMock } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'eq', 'single']),
    rpcMock: vi.fn((): Promise<{ error: unknown }> => Promise.resolve({ error: null })),
  }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder), rpc: rpcMock } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: { pay_account_id: 'a1' }, error: null }
  rpcMock.mockResolvedValue({ error: null })
})

describe('usePayAccount', () => {
  it('loads the household pay account on mount', async () => {
    const { result } = renderHook(() => usePayAccount(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.payAccountId).toBe('a1')
  })

  it('sets the pay account via the RPC and reloads', async () => {
    const { result } = renderHook(() => usePayAccount(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: { pay_account_id: 'a2' }, error: null }
    await act(async () => {
      await result.current.setPayAccount('a2')
    })
    expect(rpcMock).toHaveBeenCalledWith('set_household_pay_account', { p_account_id: 'a2' })
    expect(result.current.payAccountId).toBe('a2')
  })

  it('clears the pay account with a null argument', async () => {
    const { result } = renderHook(() => usePayAccount(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: { pay_account_id: null }, error: null }
    await act(async () => {
      await result.current.setPayAccount(null)
    })
    expect(rpcMock).toHaveBeenCalledWith('set_household_pay_account', { p_account_id: null })
    expect(result.current.payAccountId).toBeNull()
  })

  it('propagates load and rpc errors', async () => {
    const { result } = renderHook(() => usePayAccount(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: null, error: new Error('load failed') }
    await expect(result.current.reload()).rejects.toThrow('load failed')

    rpcMock.mockResolvedValue({ error: new Error('rpc failed') })
    await expect(result.current.setPayAccount('a2')).rejects.toThrow('rpc failed')
  })
})
