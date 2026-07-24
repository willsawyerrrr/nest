import { describe, expect, it } from 'vitest'
import {
  accruedBalanceCents,
  projectSuperBalance,
  toProjectionInput,
  yearsToRetirement,
} from './retirement'

describe('projectSuperBalance', () => {
  it('returns the current balance when years is zero or negative', () => {
    const input = {
      currentBalanceCents: 100_000_00,
      annualContributionCents: 20_000_00,
      nominalReturnRate: 0.07,
      inflationRate: 0.025,
      contributionGrowthRate: 0.03,
    }
    expect(projectSuperBalance({ ...input, years: 0 })).toEqual({
      nominalCents: 100_000_00,
      realCents: 100_000_00,
    })
    expect(projectSuperBalance({ ...input, years: -5 })).toEqual({
      nominalCents: 100_000_00,
      realCents: 100_000_00,
    })
  })

  it('adds contributions without growth when all rates are zero', () => {
    // 10 contributions of $20k, no return, no inflation → $200k on top of balance.
    expect(
      projectSuperBalance({
        currentBalanceCents: 50_000_00,
        annualContributionCents: 20_000_00,
        years: 10,
        nominalReturnRate: 0,
        inflationRate: 0,
        contributionGrowthRate: 0,
      }),
    ).toEqual({ nominalCents: 250_000_00, realCents: 250_000_00 })
  })

  it('compounds the current balance with a zero contribution', () => {
    // $100k at 10% for 3 years = $133,100; real deflated by 0% is unchanged.
    expect(
      projectSuperBalance({
        currentBalanceCents: 100_000_00,
        annualContributionCents: 0,
        years: 3,
        nominalReturnRate: 0.1,
        inflationRate: 0,
        contributionGrowthRate: 0,
      }),
    ).toEqual({ nominalCents: 133_100_00, realCents: 133_100_00 })
  })

  it('computes a known growing-annuity future value', () => {
    // End-of-year contributions of $1,000 at 10%, no balance, no growth:
    //   1000·1.1² + 1000·1.1 + 1000 = 1210 + 1100 + 1000 = $3,310.
    expect(
      projectSuperBalance({
        currentBalanceCents: 0,
        annualContributionCents: 1_000_00,
        years: 3,
        nominalReturnRate: 0.1,
        inflationRate: 0,
        contributionGrowthRate: 0,
      }),
    ).toEqual({ nominalCents: 3_310_00, realCents: 3_310_00 })
  })

  it('grows each contribution at the contribution-growth rate', () => {
    // Contributions grow 5% a year, invested at 10%, over 3 years:
    //   1000·1.1² + 1050·1.1 + 1102.50 = 1210 + 1155 + 1102.50 = $3,467.50.
    expect(
      projectSuperBalance({
        currentBalanceCents: 0,
        annualContributionCents: 1_000_00,
        years: 3,
        nominalReturnRate: 0.1,
        inflationRate: 0,
        contributionGrowthRate: 0.05,
      }),
    ).toEqual({ nominalCents: 3_467_50, realCents: 3_467_50 })
  })

  it('handles return equal to contribution growth (annuity singularity)', () => {
    // r = g = 10%: FV = C·n·(1+r)^(n−1) = 1000·3·1.1² = $3,630.
    expect(
      projectSuperBalance({
        currentBalanceCents: 0,
        annualContributionCents: 1_000_00,
        years: 3,
        nominalReturnRate: 0.1,
        inflationRate: 0,
        contributionGrowthRate: 0.1,
      }).nominalCents,
    ).toBe(3_630_00)
  })

  it('deflates the nominal balance to today’s dollars by inflation', () => {
    // Balance only, so real = nominal / (1+inflation)^years.
    const { nominalCents, realCents } = projectSuperBalance({
      currentBalanceCents: 100_000_00,
      annualContributionCents: 0,
      years: 10,
      nominalReturnRate: 0.07,
      inflationRate: 0.025,
      contributionGrowthRate: 0,
    })
    expect(nominalCents).toBe(Math.round(100_000_00 * 1.07 ** 10))
    expect(realCents).toBe(Math.round(nominalCents / 1.025 ** 10))
    expect(realCents).toBeLessThan(nominalCents)
  })
})

describe('accruedBalanceCents', () => {
  const today = new Date('2026-07-20T00:00:00Z')

  it('returns the baseline unchanged when the as-of date is null', () => {
    expect(accruedBalanceCents(10_000_00, null, 12_000_00, today)).toBe(10_000_00)
  })

  it('accrues a proportional share of the annual contribution for a mid-year as-of', () => {
    // 2026-04-11 is 100 days before today; at $365/yr (100c/day) → $100 accrued.
    expect(accruedBalanceCents(10_000_00, '2026-04-11', 365_00, today)).toBe(10_100_00)
  })

  it('leaves the baseline unchanged when the net contribution is zero', () => {
    expect(accruedBalanceCents(10_000_00, '2025-07-20', 0, today)).toBe(10_000_00)
  })

  it('accrues a full year of contributions across a full year', () => {
    expect(accruedBalanceCents(10_000_00, '2025-07-20', 12_000_00, today)).toBe(22_000_00)
  })

  it('clamps a future as-of date to zero accrual', () => {
    expect(accruedBalanceCents(10_000_00, '2027-07-20', 12_000_00, today)).toBe(10_000_00)
  })
})

describe('yearsToRetirement', () => {
  it('is the whole-year gap, never negative', () => {
    expect(yearsToRetirement(30, 60)).toBe(30)
    expect(yearsToRetirement(65, 60)).toBe(0)
    expect(yearsToRetirement(59.6, 60)).toBe(0)
  })
})

describe('toProjectionInput', () => {
  it('converts percentages to rates and ages to a year count', () => {
    expect(
      toProjectionInput(100_000_00, 20_000_00, 35, {
        retirementAge: 60,
        expectedReturnPct: 7,
        inflationPct: 2.5,
        contributionGrowthPct: 3,
      }),
    ).toEqual({
      currentBalanceCents: 100_000_00,
      annualContributionCents: 20_000_00,
      years: 25,
      nominalReturnRate: 0.07,
      inflationRate: 0.025,
      contributionGrowthRate: 0.03,
    })
  })
})
