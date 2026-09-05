import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../lib/supabase'
import { useChangelog } from './useChangelog'
import {
  resetChangelogUpdateAvailable,
  useChangelogUpdateAvailable,
} from './useChangelogUpdateAvailable'

vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

const invoke = vi.mocked(supabase.functions.invoke)

describe('useChangelog', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetChangelogUpdateAvailable()
    invoke.mockResolvedValue({
      data: { configured: true, implemented: [], inProgress: [] },
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('passes the build commit SHA when one is stamped in', async () => {
    vi.stubEnv('VITE_COMMIT_SHA', 'abc123')
    const { result } = renderHook(() => useChangelog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(invoke).toHaveBeenCalledWith('changelog', { body: { sha: 'abc123' } })
  })

  it('sends an empty body when no build SHA is stamped in', async () => {
    vi.stubEnv('VITE_COMMIT_SHA', '')
    const { result } = renderHook(() => useChangelog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(invoke).toHaveBeenCalledWith('changelog', { body: {} })
  })

  it('loads the available, implemented and in-progress entries', async () => {
    invoke.mockResolvedValue({
      data: {
        configured: true,
        available: [{ type: 'feat', scope: null, description: 'z', date: 'd', sha: 'n' }],
        implemented: [{ type: 'feat', scope: null, description: 'x', date: 'd', sha: 's' }],
        inProgress: [{ type: 'fix', scope: 'a', description: 'y', number: 1, url: 'u' }],
      },
      error: null,
    })
    const { result } = renderHook(() => useChangelog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.configured).toBe(true)
    expect(result.current.available).toHaveLength(1)
    expect(result.current.available[0]?.sha).toBe('n')
    expect(result.current.implemented).toHaveLength(1)
    expect(result.current.inProgress).toHaveLength(1)
    expect(result.current.error).toBeNull()
  })

  it('defaults available to an empty list when the response omits it', async () => {
    invoke.mockResolvedValue({
      data: { configured: true, implemented: [], inProgress: [] },
      error: null,
    })
    const { result } = renderHook(() => useChangelog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.available).toEqual([])
  })

  it('reports no update available to shared subscribers when the list is empty', async () => {
    const { result: available } = renderHook(() => useChangelogUpdateAvailable())
    const { result } = renderHook(() => useChangelog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(available.current).toBe(false)
  })

  it('reports an update available to shared subscribers when the list is non-empty', async () => {
    invoke.mockResolvedValue({
      data: {
        configured: true,
        available: [{ type: 'feat', scope: null, description: 'z', date: 'd', sha: 'n' }],
        implemented: [],
        inProgress: [],
      },
      error: null,
    })
    const { result: available } = renderHook(() => useChangelogUpdateAvailable())
    const { result } = renderHook(() => useChangelog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(available.current).toBe(true)
  })

  it('surfaces an error when the function fails', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('boom') })
    const { result } = renderHook(() => useChangelog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toMatch(/could not load/i)
  })

  it('ignores a late response after unmount', async () => {
    let resolveInvoke!: (value: { data: unknown; error: unknown }) => void
    invoke.mockReturnValue(
      new Promise((resolve) => {
        resolveInvoke = resolve
      }) as never,
    )
    const { result, unmount } = renderHook(() => useChangelog())
    unmount()
    await act(async () => {
      resolveInvoke({ data: { configured: true, implemented: [], inProgress: [] }, error: null })
    })
    // No state applied after unmount; the loading flag stays as it was.
    expect(result.current.loading).toBe(true)
  })
})
