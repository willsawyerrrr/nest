import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useShareGrant } from './useShareGrant'

const { builder, invoke, rpc } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return {
    builder: makeSupabaseBuilder(['select', 'maybeSingle']),
    invoke: vi.fn(),
    rpc: vi.fn(),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(() => builder), functions: { invoke }, rpc },
}))

const activeGrant = {
  household_id: 'h1',
  financial_year: 2027,
  recipient_email: 'agent@example.com',
  expires_at: '2027-01-08T00:00:00Z',
  created_at: '2027-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: null, error: null }
  invoke.mockResolvedValue({
    data: { token: 't'.repeat(64), expiresAt: '2027-01-08T00:00:00Z', emailSent: true },
    error: null,
  })
  rpc.mockResolvedValue({ error: null })
})

describe('useShareGrant', () => {
  it('reports no active share when none exists', async () => {
    const { result } = renderHook(() => useShareGrant())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.status).toBeNull()
  })

  it('loads the household active share on mount', async () => {
    builder.result = { data: activeGrant, error: null }
    const { result } = renderHook(() => useShareGrant())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.status).toEqual(activeGrant)
  })

  it('creates a share via share-create and reloads', async () => {
    const { result } = renderHook(() => useShareGrant())
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: activeGrant, error: null }
    let created: Awaited<ReturnType<typeof result.current.create>> | undefined
    await act(async () => {
      created = await result.current.create(2027, 'agent@example.com')
    })

    expect(invoke).toHaveBeenCalledWith('share-create', {
      body: { financialYear: 2027, recipientEmail: 'agent@example.com' },
    })
    expect(created).toEqual({
      token: 't'.repeat(64),
      expiresAt: '2027-01-08T00:00:00Z',
      emailSent: true,
    })
    expect(result.current.status).toEqual(activeGrant)
  })

  it('revokes the share via the RPC and reloads', async () => {
    builder.result = { data: activeGrant, error: null }
    const { result } = renderHook(() => useShareGrant())
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: null, error: null }
    await act(async () => {
      await result.current.revoke()
    })

    expect(rpc).toHaveBeenCalledWith('revoke_share_grant')
    expect(result.current.status).toBeNull()
  })

  it('propagates load, create, and revoke errors', async () => {
    const { result } = renderHook(() => useShareGrant())
    await waitFor(() => expect(result.current.loading).toBe(false))

    builder.result = { data: null, error: new Error('load failed') }
    await expect(result.current.reload()).rejects.toThrow('load failed')

    invoke.mockResolvedValue({ data: null, error: new Error('create failed') })
    await expect(result.current.create(2027, 'agent@example.com')).rejects.toThrow('create failed')

    rpc.mockResolvedValue({ error: new Error('revoke failed') })
    await expect(result.current.revoke()).rejects.toThrow('revoke failed')
  })
})
