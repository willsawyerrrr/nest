import { describe, expect, it } from 'vitest'
import { formatIsoDate, todayIso } from './dates'

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
