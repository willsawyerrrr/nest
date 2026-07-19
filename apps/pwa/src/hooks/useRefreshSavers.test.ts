import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRefreshSavers } from './useRefreshSavers'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}))

const invoke = vi.mocked(supabase.functions.invoke)

describe('useRefreshSavers', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue({ data: null, error: null })
  })

  it('invokes up-sync, shows a pending state, then reloads on success', async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    let resolveInvoke!: (value: Awaited<ReturnType<typeof supabase.functions.invoke>>) => void
    invoke.mockReturnValue(
      new Promise((resolve) => {
        resolveInvoke = resolve
      }),
    )
    const { result } = renderHook(() => useRefreshSavers(reload))

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.refresh()
    })
    await waitFor(() => expect(result.current.refreshing).toBe(true))
    expect(reload).not.toHaveBeenCalled()

    await act(async () => {
      resolveInvoke({ data: null, error: null })
      await pending
    })

    expect(invoke).toHaveBeenCalledWith('up-sync', { body: {} })
    expect(reload).toHaveBeenCalledOnce()
    expect(result.current.refreshing).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('surfaces an error and does not reload when the sync fails', async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    invoke.mockResolvedValue({ data: null, error: new Error('boom') })
    const { result } = renderHook(() => useRefreshSavers(reload))

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.error).toMatch(/could not refresh/i)
    expect(reload).not.toHaveBeenCalled()
    expect(result.current.refreshing).toBe(false)
  })
})
