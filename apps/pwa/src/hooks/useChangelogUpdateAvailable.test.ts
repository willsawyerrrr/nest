import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetChangelogUpdateAvailable,
  setChangelogUpdateAvailable,
  useChangelogUpdateAvailable,
} from './useChangelogUpdateAvailable'

describe('useChangelogUpdateAvailable', () => {
  beforeEach(() => resetChangelogUpdateAvailable())

  it('reads false until the changelog reports an update', () => {
    const { result } = renderHook(() => useChangelogUpdateAvailable())
    expect(result.current).toBe(false)
  })

  it('flips to true once the changelog reports an update, for every subscriber', () => {
    const { result } = renderHook(() => useChangelogUpdateAvailable())

    act(() => setChangelogUpdateAvailable(true))

    expect(result.current).toBe(true)
  })

  it('does not notify subscribers when the value is unchanged', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useChangelogUpdateAvailable()
    })
    expect(renders).toBe(1)

    act(() => setChangelogUpdateAvailable(false))

    expect(renders).toBe(1)
    expect(result.current).toBe(false)
  })
})
