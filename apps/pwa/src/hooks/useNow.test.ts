import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCurrentFinancialYear, useNow } from './useNow'

describe('useNow', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds the time of the first render across re-renders', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T00:00:00Z'))
    const { result, rerender } = renderHook(() => useNow())
    const first = result.current
    vi.setSystemTime(new Date('2026-10-07T00:00:00Z'))
    rerender()
    expect(result.current).toBe(first)
  })

  it('reads the financial year the first render fell in', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T00:00:00Z'))
    const { result, rerender } = renderHook(() => useCurrentFinancialYear())
    expect(result.current).toBe(2027)
    vi.setSystemTime(new Date('2027-07-02T00:00:00Z'))
    rerender()
    expect(result.current).toBe(2027)
  })
})
