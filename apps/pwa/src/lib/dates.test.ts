import { describe, expect, it } from 'vitest'
import { formatIsoDate, isoDate, isoDaysBefore, todayIso } from './dates'

describe('formatIsoDate', () => {
  it('formats an ISO date as a short local date', () => {
    expect(formatIsoDate('2027-02-28')).toBe('28 Feb 2027')
  })
})

describe('todayIso', () => {
  it('formats a given date as YYYY-MM-DD, zero-padding month and day', () => {
    expect(todayIso(new Date(2027, 1, 5))).toBe('2027-02-05')
  })

  it('defaults to the current date', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('isoDate', () => {
  it('takes the local calendar date of an instant, not its UTC text', () => {
    // Local 11pm on 20 Nov is 21 Nov in UTC east of Greenwich, yet the local
    // calendar date governs.
    expect(isoDate(new Date(2026, 10, 20, 23, 30))).toBe('2026-11-20')
  })
})

describe('isoDaysBefore', () => {
  it('counts back over a month boundary', () => {
    expect(isoDaysBefore('2026-07-14', 13)).toBe('2026-07-01')
    expect(isoDaysBefore('2026-07-07', 13)).toBe('2026-06-24')
  })
})
