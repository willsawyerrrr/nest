import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIsWide, WIDE_BREAKPOINT } from './useIsWide'

const useMediaQuery = vi.fn()

vi.mock('@mantine/hooks', () => ({ useMediaQuery: (query: string) => useMediaQuery(query) }))

beforeEach(() => vi.clearAllMocks())

describe('useIsWide', () => {
  it('queries the wide breakpoint and returns a match', () => {
    useMediaQuery.mockReturnValue(true)
    const { result } = renderHook(() => useIsWide())
    expect(useMediaQuery).toHaveBeenCalledWith(`(min-width: ${WIDE_BREAKPOINT})`)
    expect(result.current).toBe(true)
  })

  it('returns false below the breakpoint', () => {
    useMediaQuery.mockReturnValue(false)
    const { result } = renderHook(() => useIsWide())
    expect(result.current).toBe(false)
  })
})
