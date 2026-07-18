import { describe, expect, it } from 'vitest'
import { financialYearForDate } from './index'

describe('financialYearForDate', () => {
  it('labels 1 July as the start of the new financial year', () => {
    expect(financialYearForDate(new Date('2026-07-01T00:00:00Z'))).toBe(2027)
  })

  it('labels 30 June as the end of the current financial year', () => {
    expect(financialYearForDate(new Date('2026-06-30T00:00:00Z'))).toBe(2026)
  })

  it('labels dates either side of the calendar new year', () => {
    expect(financialYearForDate(new Date('2026-12-31T00:00:00Z'))).toBe(2027)
    expect(financialYearForDate(new Date('2026-01-01T00:00:00Z'))).toBe(2026)
  })
})
