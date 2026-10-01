import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetReleaseSeen, useReleaseSeen } from './useReleaseSeen'

const changelog = vi.hoisted(() => ({ useChangelog: vi.fn() }))

vi.mock('./useChangelog', () => ({ useChangelog: changelog.useChangelog }))

const KEY = 'whats-new-seen-sha'

function entries(...shas: string[]) {
  return shas.map((sha) => ({ sha }))
}

function loaded(available: string[], implemented: string[]) {
  changelog.useChangelog.mockReturnValue({
    available: entries(...available),
    implemented: entries(...implemented),
  })
}

describe('useReleaseSeen', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    resetReleaseSeen()
  })

  it('records the newest release on first use without flagging it', () => {
    loaded([], ['b', 'a'])
    const { result } = renderHook(() => useReleaseSeen())
    expect(result.current.unseen).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('b')
  })

  it('flags a release newer than the one last seen', () => {
    localStorage.setItem(KEY, 'a')
    loaded([], ['b', 'a'])
    const { result } = renderHook(() => useReleaseSeen())
    expect(result.current.unseen).toBe(true)
  })

  it('prefers an available release over the implemented ones', () => {
    localStorage.setItem(KEY, 'b')
    loaded(['c'], ['b'])
    const { result } = renderHook(() => useReleaseSeen())
    expect(result.current.unseen).toBe(true)
  })

  it('clears once the release is marked seen, across every subscriber', () => {
    localStorage.setItem(KEY, 'a')
    loaded([], ['b', 'a'])
    const first = renderHook(() => useReleaseSeen())
    const second = renderHook(() => useReleaseSeen())

    act(() => second.result.current.markSeen())

    expect(first.result.current.unseen).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('b')
  })

  it('shows nothing and records nothing when the changelog has no release', () => {
    loaded([], [])
    const { result } = renderHook(() => useReleaseSeen())
    act(() => result.current.markSeen())
    expect(result.current.unseen).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('shows nothing while the changelog is unavailable', () => {
    localStorage.setItem(KEY, 'a')
    loaded([], [])
    const { result } = renderHook(() => useReleaseSeen())
    expect(result.current.unseen).toBe(false)
  })

  it('works in memory when storage is unavailable', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    loaded([], ['a'])
    const { result, rerender } = renderHook(() => useReleaseSeen())
    expect(result.current.unseen).toBe(false)

    loaded([], ['b', 'a'])
    rerender()
    expect(result.current.unseen).toBe(true)

    act(() => result.current.markSeen())
    expect(result.current.unseen).toBe(false)
  })
})
