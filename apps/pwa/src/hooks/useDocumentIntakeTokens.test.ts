import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useDocumentIntakeTokens } from './useDocumentIntakeTokens'

const { builder, rpc } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'order']),
    rpc: vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(() => builder), rpc },
}))

const status = { member_id: 'm1', household_id: 'h1', created_at: '2027-01-01T00:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [status], error: null }
  rpc.mockResolvedValue({
    data: [{ token: 't'.repeat(64), created_at: '2027-02-01T00:00:00Z' }],
    error: null,
  })
})

describe('useDocumentIntakeTokens', () => {
  it('exposes every household member’s token status', async () => {
    const { result } = renderHook(() => useDocumentIntakeTokens('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.statuses).toEqual([status])
  })

  it('mints a token via the RPC, reloads, and returns it once', async () => {
    const { result } = renderHook(() => useDocumentIntakeTokens('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let minted: Awaited<ReturnType<typeof result.current.create>> | undefined
    await act(async () => {
      minted = await result.current.create()
    })

    expect(rpc).toHaveBeenCalledWith('create_document_intake_token')
    expect(minted).toEqual({ token: 't'.repeat(64), createdAt: '2027-02-01T00:00:00Z' })
    expect(result.current.busy).toBe(false)
  })

  it('revokes the caller’s own token via the RPC and reloads', async () => {
    const { result } = renderHook(() => useDocumentIntakeTokens('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rpc.mockResolvedValue({ error: null })
    await act(async () => {
      await result.current.revoke()
    })

    expect(rpc).toHaveBeenCalledWith('revoke_document_intake_token')
    expect(result.current.busy).toBe(false)
  })

  it('propagates a mint error and does not clear busy prematurely', async () => {
    const { result } = renderHook(() => useDocumentIntakeTokens('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rpc.mockResolvedValue({ data: null, error: new Error('mint failed') })
    await expect(result.current.create()).rejects.toThrow('mint failed')
    expect(result.current.busy).toBe(false)
  })

  it('propagates a revoke error', async () => {
    const { result } = renderHook(() => useDocumentIntakeTokens('h1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    rpc.mockResolvedValue({ error: new Error('revoke failed') })
    await expect(result.current.revoke()).rejects.toThrow('revoke failed')
  })
})
