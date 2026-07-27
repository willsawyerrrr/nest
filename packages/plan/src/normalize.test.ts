import { describe, expect, it } from 'vitest'
import { annualCents, fortnightlyCents, periodsPerYear } from './index'

describe('annualCents', () => {
  it('annualises an amount across every frequency', () => {
    expect(annualCents(1_000_00, 'weekly')).toBe(52_000_00)
    expect(annualCents(1_000_00, 'fortnightly')).toBe(26_000_00)
    expect(annualCents(1_000_00, 'monthly')).toBe(12_000_00)
    expect(annualCents(1_000_00, 'quarterly')).toBe(4_000_00)
    expect(annualCents(1_000_00, 'biannual')).toBe(2_000_00)
    expect(annualCents(1_000_00, 'annual')).toBe(1_000_00)
  })
})

describe('periodsPerYear', () => {
  it('counts the periods of every fixed frequency', () => {
    expect(periodsPerYear('weekly')).toBe(52)
    expect(periodsPerYear('fortnightly')).toBe(26)
    expect(periodsPerYear('monthly')).toBe(12)
    expect(periodsPerYear('quarterly')).toBe(4)
    expect(periodsPerYear('biannual')).toBe(2)
    expect(periodsPerYear('annual')).toBe(1)
  })

  it('divides the weeks or months in a year by an arbitrary cadence’s interval', () => {
    expect(periodsPerYear('every_n_weeks', 2)).toBe(26)
    expect(periodsPerYear('every_n_weeks', 4)).toBe(13)
    expect(periodsPerYear('every_n_months', 3)).toBe(4)
    // An interval that does not divide the year evenly gives a fractional count.
    expect(periodsPerYear('every_n_weeks', 3)).toBeCloseTo(52 / 3)
  })

  it('counts no periods when an arbitrary cadence’s interval is missing or invalid', () => {
    expect(periodsPerYear('every_n_weeks')).toBe(0)
    expect(periodsPerYear('every_n_weeks', 0)).toBe(0)
    expect(periodsPerYear('every_n_months')).toBe(0)
    expect(periodsPerYear('every_n_months', 1.5)).toBe(0)
  })
})

describe('fortnightlyCents', () => {
  it('normalises fortnightly and annual amounts exactly', () => {
    expect(fortnightlyCents(1_000_00, 'fortnightly')).toBe(1_000_00)
    expect(fortnightlyCents(2_600_00, 'annual')).toBe(100_00)
  })

  it('rounds the per-fortnight share to whole cents', () => {
    // $800/month → $9,600/yr → 9_600_00 / 26 = 36_923.08 → 36_923.
    expect(fortnightlyCents(800_00, 'monthly')).toBe(369_23)
    // $50/month → $600/yr → 60_000 / 26 = 2_307.69 → 2_308.
    expect(fortnightlyCents(50_00, 'monthly')).toBe(23_08)
  })

  it('normalises weekly to a fortnight as twice the weekly amount', () => {
    expect(fortnightlyCents(500_00, 'weekly')).toBe(1_000_00)
  })
})

describe('every_n_weeks cadence', () => {
  it('annualises every-1-week as the weekly case', () => {
    expect(annualCents(1_000_00, 'every_n_weeks', 1)).toBe(annualCents(1_000_00, 'weekly'))
    expect(fortnightlyCents(1_000_00, 'every_n_weeks', 1)).toBe(
      fortnightlyCents(1_000_00, 'weekly'),
    )
  })

  it('annualises every-2-weeks as the fortnightly case', () => {
    expect(annualCents(1_000_00, 'every_n_weeks', 2)).toBe(annualCents(1_000_00, 'fortnightly'))
    expect(fortnightlyCents(1_000_00, 'every_n_weeks', 2)).toBe(
      fortnightlyCents(1_000_00, 'fortnightly'),
    )
  })

  it('annualises $300 every 4 weeks to $3,900/yr and $150/fortnight', () => {
    // round(300_00 × 52 / 4) = round(15_600_00 / 4) = 3_900_00.
    expect(annualCents(300_00, 'every_n_weeks', 4)).toBe(3_900_00)
    // round(3_900_00 / 26) = 150_00.
    expect(fortnightlyCents(300_00, 'every_n_weeks', 4)).toBe(150_00)
  })

  it('rounds an uneven cadence to whole cents', () => {
    // round(100_00 × 52 / 3) = round(520_000 / 3) = round(173_333.33) = 173_333.
    expect(annualCents(100_00, 'every_n_weeks', 3)).toBe(173_333)
    // round(173_333 / 26) = round(6_666.65) = 6_667.
    expect(fortnightlyCents(100_00, 'every_n_weeks', 3)).toBe(6_667)
  })

  it('defensively annualises to zero when the interval is missing or invalid', () => {
    expect(annualCents(1_000_00, 'every_n_weeks')).toBe(0)
    expect(annualCents(1_000_00, 'every_n_weeks', 0)).toBe(0)
    expect(annualCents(1_000_00, 'every_n_weeks', -2)).toBe(0)
    expect(annualCents(1_000_00, 'every_n_weeks', 1.5)).toBe(0)
    expect(fortnightlyCents(1_000_00, 'every_n_weeks')).toBe(0)
  })
})

describe('every_n_months cadence', () => {
  it('annualises every-1-month as the monthly case', () => {
    expect(annualCents(1_000_00, 'every_n_months', 1)).toBe(annualCents(1_000_00, 'monthly'))
    expect(fortnightlyCents(1_000_00, 'every_n_months', 1)).toBe(
      fortnightlyCents(1_000_00, 'monthly'),
    )
  })

  it('annualises every-3-months as the quarterly case', () => {
    expect(annualCents(1_000_00, 'every_n_months', 3)).toBe(annualCents(1_000_00, 'quarterly'))
    expect(fortnightlyCents(1_000_00, 'every_n_months', 3)).toBe(
      fortnightlyCents(1_000_00, 'quarterly'),
    )
  })

  it('annualises every-6-months as the biannual case', () => {
    expect(annualCents(1_000_00, 'every_n_months', 6)).toBe(annualCents(1_000_00, 'biannual'))
    expect(fortnightlyCents(1_000_00, 'every_n_months', 6)).toBe(
      fortnightlyCents(1_000_00, 'biannual'),
    )
  })

  it('annualises every-12-months as the annual case', () => {
    expect(annualCents(1_000_00, 'every_n_months', 12)).toBe(annualCents(1_000_00, 'annual'))
    expect(fortnightlyCents(1_000_00, 'every_n_months', 12)).toBe(
      fortnightlyCents(1_000_00, 'annual'),
    )
  })

  it('rounds an uneven cadence to whole cents', () => {
    // round(100_00 × 12 / 5) = round(120_000 / 5) = 24_000.
    expect(annualCents(100_00, 'every_n_months', 5)).toBe(24_000)
    // round(1_000_00 × 12 / 7) = round(1_200_000 / 7) = round(171_428.57) = 171_429.
    expect(annualCents(1_000_00, 'every_n_months', 7)).toBe(171_429)
    // round(171_429 / 26) = round(6_593.42) = 6_593.
    expect(fortnightlyCents(1_000_00, 'every_n_months', 7)).toBe(6_593)
  })

  it('defensively annualises to zero when the interval is missing or invalid', () => {
    expect(annualCents(1_000_00, 'every_n_months')).toBe(0)
    expect(annualCents(1_000_00, 'every_n_months', 0)).toBe(0)
    expect(annualCents(1_000_00, 'every_n_months', -2)).toBe(0)
    expect(annualCents(1_000_00, 'every_n_months', 1.5)).toBe(0)
    expect(fortnightlyCents(1_000_00, 'every_n_months')).toBe(0)
  })
})
