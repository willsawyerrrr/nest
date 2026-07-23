import { describe, expect, it } from 'vitest'
import type { EquityGrant } from './equity'
import { projectNetWorth } from './netWorthProjection'

const flatSuper = {
  currentBalanceCents: 0,
  annualContributionCents: 0,
  nominalReturnRate: 0,
  contributionGrowthRate: 0,
}

/** A fully vested share grant worth `quantity × pricePerShareCents` from `grantDate`. */
function vestedShares(
  quantity: number,
  pricePerShareCents: number,
  grantDate = '2000-01-01',
): EquityGrant {
  return {
    quantity,
    grantDate,
    cliffMonths: 0,
    vestingPeriodMonths: 1,
    vestingFrequency: 'monthly',
    instrumentType: 'share',
    strikePriceCents: null,
    pricePerShareCents,
  }
}

describe('projectNetWorth', () => {
  it('returns a single year-0 point at the horizon floor', () => {
    const points = projectNetWorth({
      asOf: new Date('2026-07-01'),
      horizonYears: 0,
      superInput: { ...flatSuper, currentBalanceCents: 100_000_00 },
      otherCents: 20_000_00,
      equityGrants: [],
      helpCentsByYear: [],
    })
    expect(points).toHaveLength(1)
    expect(points[0]).toEqual({
      year: 0,
      superCents: 100_000_00,
      otherCents: 20_000_00,
      equityCents: 0,
      helpCents: 0,
      totalCents: 120_000_00,
    })
  })

  it('holds cash flat and compounds super each year', () => {
    // $100k super at 10% for 2 years → $110k then $121k; cash unchanged.
    const points = projectNetWorth({
      asOf: new Date('2026-07-01'),
      horizonYears: 2,
      superInput: { ...flatSuper, currentBalanceCents: 100_000_00, nominalReturnRate: 0.1 },
      otherCents: 5_000_00,
      equityGrants: [],
      helpCentsByYear: [],
    })
    expect(points.map((p) => p.superCents)).toEqual([100_000_00, 110_000_00, 121_000_00])
    expect(points.map((p) => p.otherCents)).toEqual([5_000_00, 5_000_00, 5_000_00])
    expect(points.map((p) => p.totalCents)).toEqual([105_000_00, 115_000_00, 126_000_00])
  })

  it('grows the equity line as a grant vests over time', () => {
    // 12-month vesting, no cliff: half vested after 6 months, fully after a year.
    const grant: EquityGrant = {
      quantity: 1200,
      grantDate: '2026-01-01',
      cliffMonths: 0,
      vestingPeriodMonths: 12,
      vestingFrequency: 'monthly',
      instrumentType: 'share',
      strikePriceCents: null,
      pricePerShareCents: 1_00,
    }
    const points = projectNetWorth({
      asOf: new Date('2026-01-01'),
      horizonYears: 2,
      superInput: flatSuper,
      otherCents: 0,
      equityGrants: [grant],
      helpCentsByYear: [],
    })
    // Year 0 nothing vested, year 1 fully vested (1200 × $1), year 2 unchanged.
    expect(points.map((p) => p.equityCents)).toEqual([0, 1_200_00, 1_200_00])
  })

  it('subtracts a shrinking HELP balance from the total', () => {
    const points = projectNetWorth({
      asOf: new Date('2026-07-01'),
      horizonYears: 3,
      superInput: { ...flatSuper, currentBalanceCents: 50_000_00 },
      otherCents: 0,
      equityGrants: [],
      helpCentsByYear: [30_000_00, 20_000_00, 10_000_00, 0],
    })
    expect(points.map((p) => p.helpCents)).toEqual([30_000_00, 20_000_00, 10_000_00, 0])
    expect(points.map((p) => p.totalCents)).toEqual([20_000_00, 30_000_00, 40_000_00, 50_000_00])
  })

  it('reuses the last HELP entry when the schedule is shorter than the horizon', () => {
    const points = projectNetWorth({
      asOf: new Date('2026-07-01'),
      horizonYears: 4,
      superInput: flatSuper,
      otherCents: 0,
      equityGrants: [],
      helpCentsByYear: [10_000_00, 8_000_00],
    })
    // Beyond index 1 the last value (8_000_00) is held.
    expect(points.map((p) => p.helpCents)).toEqual([
      10_000_00, 8_000_00, 8_000_00, 8_000_00, 8_000_00,
    ])
  })

  it('projects an all-empty household as a flat zero series without crashing', () => {
    const points = projectNetWorth({
      asOf: new Date('2026-07-01'),
      horizonYears: 3,
      superInput: flatSuper,
      otherCents: 0,
      equityGrants: [],
      helpCentsByYear: [],
    })
    expect(points).toHaveLength(4)
    expect(points.every((p) => p.totalCents === 0)).toBe(true)
  })

  it('sums every component into the total', () => {
    const points = projectNetWorth({
      asOf: new Date('2026-07-01'),
      horizonYears: 1,
      superInput: { ...flatSuper, currentBalanceCents: 40_000_00 },
      otherCents: 10_000_00,
      equityGrants: [vestedShares(1000, 5_00)],
      helpCentsByYear: [15_000_00, 15_000_00],
    })
    // 40k super + 10k cash + (1000 × $5 = $5k) equity − 15k HELP = 40k.
    expect(points[0]).toMatchObject({
      superCents: 40_000_00,
      otherCents: 10_000_00,
      equityCents: 5_000_00,
      helpCents: 15_000_00,
      totalCents: 40_000_00,
    })
  })
})
