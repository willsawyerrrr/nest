import { describe, expect, it } from 'vitest'
import { annualCents, fortnightlyCents, periodsPerYear, perPeriodCents } from './index.ts'

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

describe('perPeriodCents', () => {
  it('draws a per-period figure from an annual total on every fixed frequency', () => {
    expect(perPeriodCents(52_000_00, 'weekly')).toBe(1_000_00)
    expect(perPeriodCents(26_000_00, 'fortnightly')).toBe(1_000_00)
    expect(perPeriodCents(12_000_00, 'monthly')).toBe(1_000_00)
    expect(perPeriodCents(4_000_00, 'quarterly')).toBe(1_000_00)
    expect(perPeriodCents(2_000_00, 'biannual')).toBe(1_000_00)
    expect(perPeriodCents(1_000_00, 'annual')).toBe(1_000_00)
  })

  it('rounds the per-period figure to whole cents, leaving the annual it came from alone', () => {
    // $100,000/yr over 26 fortnights = 384_615.38 → 384_615, which adds back up to
    // 9_999_990 — ten cents short of the annual it was drawn from.
    expect(perPeriodCents(100_000_00, 'fortnightly')).toBe(3_846_15)
    expect(annualCents(perPeriodCents(100_000_00, 'fortnightly'), 'fortnightly')).toBe(99_999_90)
    // $50,000/yr over 12 months = 416_666.67 → 416_667, four cents over.
    expect(perPeriodCents(50_000_00, 'monthly')).toBe(4_166_67)
    expect(annualCents(perPeriodCents(50_000_00, 'monthly'), 'monthly')).toBe(50_000_04)
  })

  it('divides an annual total over an arbitrary cadence’s periods', () => {
    expect(perPeriodCents(13_000_00, 'every_n_weeks', 4)).toBe(1_000_00)
    expect(perPeriodCents(4_000_00, 'every_n_months', 3)).toBe(1_000_00)
    // 52/3 periods: round(300_00 × 3 / 52) = round(1_730.77) = 1_731.
    expect(perPeriodCents(300_00, 'every_n_weeks', 3)).toBe(17_31)
  })

  it('defensively yields zero when an arbitrary cadence’s interval is missing or invalid', () => {
    expect(perPeriodCents(13_000_00, 'every_n_weeks')).toBe(0)
    expect(perPeriodCents(13_000_00, 'every_n_weeks', 0)).toBe(0)
    expect(perPeriodCents(13_000_00, 'every_n_months', 1.5)).toBe(0)
  })

  it('round-trips a stored per-period figure through its annual total unchanged', () => {
    for (const cents of [5_000_00, 3_846_15, 1_23]) {
      expect(perPeriodCents(annualCents(cents, 'fortnightly'), 'fortnightly')).toBe(cents)
      expect(perPeriodCents(annualCents(cents, 'every_n_weeks', 3), 'every_n_weeks', 3)).toBe(cents)
    }
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
