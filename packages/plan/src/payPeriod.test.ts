import { describe, expect, it } from 'vitest'
import {
  financialYearDayCount,
  financialYearPeriod,
  prorateAnnualToPeriod,
  type PayPeriod,
} from './index.ts'

/** FY2027 — 1 Jul 2026 – 30 Jun 2027, 365 days. */
const FY = 2027

/** The first fortnight of FY2027: 14 days, one whole turn of a fortnightly cadence. */
const FORTNIGHT = { periodStart: '2026-07-01', periodEnd: '2026-07-14' } as const

/** A period running `periodStart` through `periodEnd`, both inclusive. */
function period(periodStart: string, periodEnd: string): PayPeriod {
  return { periodStart, periodEnd }
}

describe('financialYearPeriod', () => {
  it('runs 1 July of the year before the label through 30 June of the label year', () => {
    expect(financialYearPeriod(FY)).toEqual(period('2026-07-01', '2027-06-30'))
  })
})

describe('financialYearDayCount', () => {
  it('counts 365 days in a financial year ending in a non-leap year', () => {
    expect(financialYearDayCount(2027)).toBe(365)
  })

  it('counts 366 days in a financial year ending in a leap year', () => {
    // FY2028 runs 1 Jul 2027 – 30 Jun 2028 and so contains 29 Feb 2028.
    expect(financialYearDayCount(2028)).toBe(366)
  })
})

describe('prorateAnnualToPeriod', () => {
  it('prorates an annual figure to the period by calendar days, to whole cents', () => {
    // $36,500 × 14/365 = $1,400.00 exactly.
    expect(prorateAnnualToPeriod(36_500_00, FORTNIGHT, FY)).toBe(1_400_00)
    // $130,000 × 14/365 = $4,986.3013… → $4,986.30.
    expect(prorateAnnualToPeriod(130_000_00, FORTNIGHT, FY)).toBe(4_986_30)
  })

  it('counts every day of a period straddling 30 June, whichever year it is filed under', () => {
    // Worked 24 June – 7 July 2027 and paid in July, so filed under FY2028 rather
    // than the FY2027 its first week fell in. The period is not clipped either
    // way: all 14 days count, and the year it is filed under only chooses the
    // denominator — 366 for the leap FY2028 against FY2027's 365.
    const straddling = period('2027-06-24', '2027-07-07')
    expect(prorateAnnualToPeriod(130_000_00, straddling, 2028)).toBe(4_972_68)
    expect(prorateAnnualToPeriod(130_000_00, straddling, FY)).toBe(4_986_30)
  })

  it('prorates nothing to a period ending before it starts', () => {
    expect(prorateAnnualToPeriod(130_000_00, period('2026-07-14', '2026-07-01'), FY)).toBe(0)
  })
})
