import { describe, expect, it } from 'vitest'
import { isBudgetLineActive, isBudgetLineRetired, localIsoDate } from './index.ts'

describe('isBudgetLineActive', () => {
  it('is active from its start day up to, not including, its retirement day', () => {
    const rent = { startsOn: '2026-01-01', retiredOn: '2026-10-10' }
    expect(isBudgetLineActive(rent, '2025-12-31')).toBe(false)
    expect(isBudgetLineActive(rent, '2026-01-01')).toBe(true)
    expect(isBudgetLineActive(rent, '2026-10-09')).toBe(true)
    expect(isBudgetLineActive(rent, '2026-10-10')).toBe(false)
  })

  it('reads absent bounds as open', () => {
    expect(isBudgetLineActive({}, '2026-10-10')).toBe(true)
    expect(isBudgetLineActive({ startsOn: null, retiredOn: null }, '2026-10-10')).toBe(true)
  })
})

describe('isBudgetLineRetired', () => {
  it('is retired from its retirement day on, and never before or while live', () => {
    expect(isBudgetLineRetired({ retiredOn: '2026-10-10' }, '2026-10-09')).toBe(false)
    expect(isBudgetLineRetired({ retiredOn: '2026-10-10' }, '2026-10-10')).toBe(true)
    expect(isBudgetLineRetired({ startsOn: '2027-01-01' }, '2026-10-10')).toBe(false)
  })
})

describe('localIsoDate', () => {
  it('reads the local day in the given timezone, not UTC', () => {
    // 9am on 25 November in Sydney is still 24 November in UTC.
    const now = new Date('2026-11-24T22:00:00Z')
    expect(localIsoDate(now, 'Australia/Sydney')).toBe('2026-11-25')
    expect(localIsoDate(now, 'UTC')).toBe('2026-11-24')
  })

  it('reads a Brisbane household its own day, an hour behind Sydney in summer', () => {
    // 12:30am on 1 December in Brisbane is 1:30am in Sydney and 30 November in UTC.
    const now = new Date('2026-11-30T14:30:00Z')
    expect(localIsoDate(now, 'Australia/Brisbane')).toBe('2026-12-01')
    // 11:30pm on 30 November in Brisbane is already 1 December in Sydney.
    const lateNight = new Date('2026-11-30T13:30:00Z')
    expect(localIsoDate(lateNight, 'Australia/Brisbane')).toBe('2026-11-30')
    expect(localIsoDate(lateNight, 'Australia/Sydney')).toBe('2026-12-01')
  })
})
