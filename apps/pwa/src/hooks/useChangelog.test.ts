import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../lib/supabase'
import { useChangelog } from './useChangelog'

vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))

const invoke = vi.mocked(supabase.functions.invoke)

describe('useChangelog', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('loads the implemented and in-progress entries', async () => {
    invoke.mockResolvedValue({
      data: {
        configured: true,
        implemented: [{ type: 'feat', scope: null, description: 'x', date: 'd', sha: 's' }],
        inProgress: [{ type: 'fix', scope: 'a', description: 'y', number: 1, url: 'u' }],
      },
      error: null,
    })
    const { result } = renderHook(() => useChangelog())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.configured).toBe(true)
    expect(result.current.implemented).toHaveLength(1)
    expect(result.current.inProgress).toHaveLength(1)
    expect(result.current.error).toBeNull()
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
