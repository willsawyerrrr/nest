import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUpConnection } from './useUpConnection'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}))

const invoke = vi.mocked(supabase.functions.invoke)

describe('useUpConnection', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue({ data: null, error: null })
  })

  it('connect sends the token to up-connect, then refreshes members', async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useUpConnection(reload))

    await act(async () => {
      await result.current.connect('up:yeah:secret')
    })

    expect(invoke).toHaveBeenCalledWith('up-connect', { body: { token: 'up:yeah:secret' } })
    expect(reload).toHaveBeenCalledOnce()
    expect(result.current.busy).toBe(false)
  })

  it('disconnect calls up-disconnect, then refreshes members', async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useUpConnection(reload))

    await act(async () => {
      await result.current.disconnect()
    })

    expect(invoke).toHaveBeenCalledWith('up-disconnect', { body: {} })
    expect(reload).toHaveBeenCalledOnce()
  })

  it('surfaces an edge-function error and does not refresh', async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    invoke.mockResolvedValue({ data: null, error: new Error('rejected') })
    const { result } = renderHook(() => useUpConnection(reload))

    await expect(result.current.connect('bad')).rejects.toThrow('rejected')
    expect(reload).not.toHaveBeenCalled()
  })
})
