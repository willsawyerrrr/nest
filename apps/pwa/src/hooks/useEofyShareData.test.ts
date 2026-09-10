import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { useEofyShareData, type EofyShareData } from './useEofyShareData'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke } } }))

const shareData: EofyShareData = {
  financialYear: 2027,
  members: [{ id: 'm1', name: 'Alex', date_of_birth: null }],
  inflows: [],
  taxProfiles: [],
  superContributions: [],
  superProfiles: [],
  helpDebts: [],
  deductions: [],
  deductionReceipts: [],
  payslips: [],
  savingsGoals: [],
  accounts: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useEofyShareData', () => {
  it('starts loading and then reports the ready data', async () => {
    invoke.mockResolvedValue({ data: shareData, error: null, response: undefined })
    const { result } = renderHook(() => useEofyShareData('a-token'), { wrapper: makeWrapper() })

    expect(result.current).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(invoke).toHaveBeenCalledWith('eofy-share', { body: { token: 'a-token' } })
    expect(result.current).toEqual({ status: 'ready', data: shareData })
  })

  it('reads a non-2xx reply into the error message it carries', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new Error('status 401'),
      response: new Response(
        JSON.stringify({ error: 'This share link is invalid or has expired.' }),
        { status: 401 },
      ),
    })
    const { result } = renderHook(() => useEofyShareData('bad-token'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current).toEqual({
      status: 'error',
      message: 'This share link is invalid or has expired.',
    })
  })

  it('falls back to a generic message on a transport failure with no response', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('network error'), response: undefined })
    const { result } = renderHook(() => useEofyShareData('a-token'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current).toEqual({
      status: 'error',
      message: 'This share link is invalid or has expired.',
    })
  })

  it('falls back to a generic message when the response body is not JSON', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new Error('status 500'),
      response: new Response('not json', { status: 500 }),
    })
    const { result } = renderHook(() => useEofyShareData('a-token'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current).toEqual({
      status: 'error',
      message: 'This share link is invalid or has expired.',
    })
  })

  it('reloads when the token changes', async () => {
    invoke.mockResolvedValue({ data: shareData, error: null, response: undefined })
    const { result, rerender } = renderHook(({ token }) => useEofyShareData(token), {
      wrapper: makeWrapper(),
      initialProps: { token: 'token-a' },
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    rerender({ token: 'token-b' })
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith('eofy-share', { body: { token: 'token-b' } }),
    )
  })
})
