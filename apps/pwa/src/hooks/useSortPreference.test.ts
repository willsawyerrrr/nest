import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSortPreference } from './useSortPreference'

describe('useSortPreference', () => {
  it('seeds from the default and updates the key and direction', () => {
    const { result } = renderHook(() =>
      useSortPreference<'name' | 'amount'>('sort-test', { key: 'name', direction: 'asc' }),
    )
    expect(result.current.key).toBe('name')
    expect(result.current.direction).toBe('asc')

    act(() => result.current.setKey('amount'))
    expect(result.current.key).toBe('amount')

    act(() => result.current.toggleDirection())
    expect(result.current.direction).toBe('desc')

    act(() => result.current.toggleDirection())
    expect(result.current.direction).toBe('asc')
  })
})
