import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HouseholdProvider, useHouseholdId, useHouseholdTimeZone } from './HouseholdProvider'

describe('useHouseholdId', () => {
  it('returns the id the provider was given', () => {
    const { result } = renderHook(() => useHouseholdId(), {
      wrapper: ({ children }) => (
        <HouseholdProvider householdId="hh-42" timeZone="Australia/Brisbane">
          {children}
        </HouseholdProvider>
      ),
    })
    expect(result.current).toBe('hh-42')
  })

  it('returns the timezone the provider was given', () => {
    const { result } = renderHook(() => useHouseholdTimeZone(), {
      wrapper: ({ children }) => (
        <HouseholdProvider householdId="hh-42" timeZone="Australia/Brisbane">
          {children}
        </HouseholdProvider>
      ),
    })
    expect(result.current).toBe('Australia/Brisbane')
  })

  it('throws when used outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useHouseholdId())).toThrow(
      'useHouseholdId must be used within a HouseholdProvider',
    )
    vi.restoreAllMocks()
  })
})
