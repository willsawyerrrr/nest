import { afterEach, describe, expect, it, vi } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import { currentTaxConfig } from '../tax.ts'

describe('currentTaxConfig', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('selects the versioned config for a date inside its financial year', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T00:00:00Z'))
    const config = currentTaxConfig()
    expect(config.financialYear).toBe(2027)
    expect(config).toBe(FY2027_CONFIG)
  })

  it('falls back to FY2027 for a date whose financial year has no config', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2050-01-01T00:00:00Z'))
    const config = currentTaxConfig()
    expect(config.financialYear).toBe(2027)
    expect(config).toBe(FY2027_CONFIG)
  })
})
