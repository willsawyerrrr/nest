import { describe, expect, it } from 'vitest'
import type { EquityGrant } from './equity.ts'
import { projectNetWorth, type NetWorthProjectionInput } from './netWorthProjection.ts'

const flatSuper = {
  currentBalanceCents: 0,
  annualContributionCents: 0,
  nominalReturnRate: 0,
  contributionGrowthRate: 0,
}

/** The projection input with empty components, overridden per test. */
function input(overrides: Partial<NetWorthProjectionInput>): NetWorthProjectionInput {
  return {
    asOf: new Date('2026-07-01'),
    horizonYears: 0,
    superInput: flatSuper,
    otherCents: 0,
    equityGrants: [],
    helpCentsByYear: [],
    savingsGoals: [],
    debtCents: 0,
    ...overrides,
  }
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
    const points = projectNetWorth(
      input({
        superInput: { ...flatSuper, currentBalanceCents: 100_000_00 },
        otherCents: 20_000_00,
      }),
    )
    expect(points).toHaveLength(1)
    expect(points[0]).toEqual({
      year: 0,
      superCents: 100_000_00,
      otherCents: 20_000_00,
      equityCents: 0,
      helpCents: 0,
      debtCents: 0,
      totalCents: 120_000_00,
    })
  })

  it('holds cash flat without goals and compounds super each year', () => {
    // $100k super at 10% for 2 years → $110k then $121k; cash unchanged.
    const points = projectNetWorth(
      input({
        horizonYears: 2,
        superInput: { ...flatSuper, currentBalanceCents: 100_000_00, nominalReturnRate: 0.1 },
        otherCents: 5_000_00,
      }),
    )
    expect(points.map((p) => p.superCents)).toEqual([100_000_00, 110_000_00, 121_000_00])
    expect(points.map((p) => p.otherCents)).toEqual([5_000_00, 5_000_00, 5_000_00])
    expect(points.map((p) => p.totalCents)).toEqual([105_000_00, 115_000_00, 126_000_00])
  })

  it('grows the cash line by each goal contribution accrued to the year', () => {
    // $100/fn = $2,600/year: cash climbs by that each year on top of the base.
    const points = projectNetWorth(
      input({
        horizonYears: 2,
        otherCents: 10_000_00,
        savingsGoals: [
          {
            targetAmountCents: 1_000_000_00,
            currentBalanceCents: 0,
            fortnightlyContributionCents: 100_00,
          },
        ],
      }),
    )
    expect(points.map((p) => p.otherCents)).toEqual([10_000_00, 12_600_00, 15_200_00])
    expect(points.map((p) => p.totalCents)).toEqual([10_000_00, 12_600_00, 15_200_00])
  })

  it('caps a goal contribution at its remaining-to-target, then holds flat', () => {
    // $2,600/year contribution, but only $3,000 remains to the target: the goal
    // adds $2,600 in year 1 and the final $400 by year 2, then nothing more.
    const points = projectNetWorth(
      input({
        horizonYears: 3,
        otherCents: 0,
        savingsGoals: [
          {
            targetAmountCents: 5_000_00,
            currentBalanceCents: 2_000_00,
            fortnightlyContributionCents: 100_00,
          },
        ],
      }),
    )
    expect(points.map((p) => p.otherCents)).toEqual([0, 2_600_00, 3_000_00, 3_000_00])
  })

  it('does not re-add a linked goal current balance, only its future contributions', () => {
    // The goal's $8k current balance already sits in the $8k cash base, so the
    // projection adds only future contributions (capped at the $2k remaining),
    // never counting the balance twice.
    const points = projectNetWorth(
      input({
        horizonYears: 2,
        otherCents: 8_000_00,
        savingsGoals: [
          {
            targetAmountCents: 10_000_00,
            currentBalanceCents: 8_000_00,
            fortnightlyContributionCents: 100_00,
          },
        ],
      }),
    )
    // Year 0 stays at the $8k base (no double count); contributions cap at $2k.
    expect(points.map((p) => p.otherCents)).toEqual([8_000_00, 10_000_00, 10_000_00])
  })

  it('adds nothing for a goal already at its target', () => {
    const points = projectNetWorth(
      input({
        horizonYears: 2,
        otherCents: 5_000_00,
        savingsGoals: [
          {
            targetAmountCents: 5_000_00,
            currentBalanceCents: 5_000_00,
            fortnightlyContributionCents: 100_00,
          },
        ],
      }),
    )
    expect(points.map((p) => p.otherCents)).toEqual([5_000_00, 5_000_00, 5_000_00])
  })

  it('holds a queued goal at zero cash until the active goal ahead of it is met', () => {
    // Active goal: $2,600 target at $100/fn ($2,600/yr) → met after year 1, when
    // its contribution frees. The queued goal ($0/fn) draws it only from then.
    const points = projectNetWorth(
      input({
        horizonYears: 2,
        otherCents: 0,
        savingsGoals: [
          {
            targetAmountCents: 2_600_00,
            currentBalanceCents: 0,
            fortnightlyContributionCents: 100_00,
          },
          {
            targetAmountCents: 1_000_000_00,
            currentBalanceCents: 0,
            fortnightlyContributionCents: 0,
            queuePosition: 0,
          },
        ],
      }),
    )
    // Year 1: active is full ($2,600); the queue has drawn one fortnight ($100).
    // The parallel model would have counted the queued goal at $2,600 here.
    expect(points.map((p) => p.otherCents)).toEqual([0, 2_700_00, 5_300_00])
  })

  it('funds the second queued goal only once the first is filled', () => {
    const points = projectNetWorth(
      input({
        horizonYears: 3,
        otherCents: 0,
        savingsGoals: [
          {
            targetAmountCents: 2_600_00,
            currentBalanceCents: 0,
            fortnightlyContributionCents: 100_00,
          },
          {
            targetAmountCents: 3_000_00,
            currentBalanceCents: 0,
            fortnightlyContributionCents: 0,
            queuePosition: 0,
          },
          {
            targetAmountCents: 1_000_000_00,
            currentBalanceCents: 0,
            fortnightlyContributionCents: 0,
            queuePosition: 1,
          },
        ],
      }),
    )
    // Through year 2 the freed $100/fn all goes to the first queued goal, so the
    // second stays at zero; only in year 3 does it begin to draw.
    expect(points.map((p) => p.otherCents)).toEqual([0, 2_700_00, 5_300_00, 7_900_00])
  })

  it('caps a queued goal at its planned contribution so its cash accrues more slowly', () => {
    const goals = (plannedContributionCents: number | null) => [
      {
        targetAmountCents: 2_600_00,
        currentBalanceCents: 0,
        fortnightlyContributionCents: 200_00,
      },
      {
        targetAmountCents: 10_000_00,
        currentBalanceCents: 0,
        fortnightlyContributionCents: 0,
        queuePosition: 0,
        plannedContributionCents,
      },
      {
        targetAmountCents: 300_00,
        currentBalanceCents: 0,
        fortnightlyContributionCents: 0,
        queuePosition: 1,
      },
    ]
    const capped = projectNetWorth(
      input({ horizonYears: 1, otherCents: 0, savingsGoals: goals(50_00) }),
    )
    const uncapped = projectNetWorth(
      input({ horizonYears: 1, otherCents: 0, savingsGoals: goals(null) }),
    )

    // Uncapped, the first queued goal takes the whole $200/fn freed from
    // fortnight 13. Capped at $50/fn it draws far less, and once the tiny second
    // goal is filled the rest of the freed capacity has nowhere to go.
    expect(capped[1]!.otherCents).toBeLessThan(uncapped[1]!.otherCents)
    expect(capped[1]!.otherCents).toBe(3_600_00)
    expect(uncapped[1]!.otherCents).toBe(5_400_00)
  })

  it('keeps unpositioned queued goals in their given order behind the active goal', () => {
    const points = projectNetWorth(
      input({
        horizonYears: 3,
        otherCents: 0,
        savingsGoals: [
          {
            targetAmountCents: 2_600_00,
            currentBalanceCents: 0,
            fortnightlyContributionCents: 100_00,
          },
          // Neither queued goal carries a `queuePosition`, so the sort leaves
          // them in input order: the $3,000 goal fills before the large one.
          {
            targetAmountCents: 3_000_00,
            currentBalanceCents: 0,
            fortnightlyContributionCents: 0,
          },
          {
            targetAmountCents: 1_000_000_00,
            currentBalanceCents: 0,
            fortnightlyContributionCents: 0,
          },
        ],
      }),
    )
    expect(points.map((p) => p.otherCents)).toEqual([0, 2_700_00, 5_300_00, 7_900_00])
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
    const points = projectNetWorth(
      input({ asOf: new Date('2026-01-01'), horizonYears: 2, equityGrants: [grant] }),
    )
    // Year 0 nothing vested, year 1 fully vested (1200 × $1), year 2 unchanged.
    expect(points.map((p) => p.equityCents)).toEqual([0, 1_200_00, 1_200_00])
  })

  it('subtracts a shrinking HELP balance from the total', () => {
    const points = projectNetWorth(
      input({
        horizonYears: 3,
        superInput: { ...flatSuper, currentBalanceCents: 50_000_00 },
        helpCentsByYear: [30_000_00, 20_000_00, 10_000_00, 0],
      }),
    )
    expect(points.map((p) => p.helpCents)).toEqual([30_000_00, 20_000_00, 10_000_00, 0])
    expect(points.map((p) => p.totalCents)).toEqual([20_000_00, 30_000_00, 40_000_00, 50_000_00])
  })

  it('reuses the last HELP entry when the schedule is shorter than the horizon', () => {
    const points = projectNetWorth(
      input({ horizonYears: 4, helpCentsByYear: [10_000_00, 8_000_00] }),
    )
    // Beyond index 1 the last value (8_000_00) is held.
    expect(points.map((p) => p.helpCents)).toEqual([
      10_000_00, 8_000_00, 8_000_00, 8_000_00, 8_000_00,
    ])
  })

  it('holds debt accounts flat as their own band and subtracts them from the total', () => {
    const points = projectNetWorth(
      input({ horizonYears: 2, otherCents: 20_000_00, debtCents: 5_000_00 }),
    )
    // Debt is a flat liability band; cash is unchanged and net worth nets them.
    expect(points.map((p) => p.debtCents)).toEqual([5_000_00, 5_000_00, 5_000_00])
    expect(points.map((p) => p.otherCents)).toEqual([20_000_00, 20_000_00, 20_000_00])
    expect(points.map((p) => p.totalCents)).toEqual([15_000_00, 15_000_00, 15_000_00])
  })

  it('reconciles the total to assets less every liability band at each point', () => {
    const points = projectNetWorth(
      input({
        horizonYears: 3,
        superInput: { ...flatSuper, currentBalanceCents: 60_000_00 },
        otherCents: 10_000_00,
        equityGrants: [vestedShares(1000, 5_00)],
        helpCentsByYear: [20_000_00, 15_000_00, 10_000_00, 0],
        debtCents: 3_000_00,
      }),
    )
    for (const p of points) {
      expect(p.totalCents).toBe(
        p.superCents + p.otherCents + p.equityCents - p.helpCents - p.debtCents,
      )
    }
    // HELP shrinks to zero while the debt band stays put.
    expect(points.map((p) => p.helpCents)).toEqual([20_000_00, 15_000_00, 10_000_00, 0])
    expect(points.map((p) => p.debtCents)).toEqual([3_000_00, 3_000_00, 3_000_00, 3_000_00])
  })

  it('projects an all-empty household as a flat zero series without crashing', () => {
    const points = projectNetWorth(input({ horizonYears: 3 }))
    expect(points).toHaveLength(4)
    expect(points.every((p) => p.totalCents === 0)).toBe(true)
  })

  it('sums every component into the total', () => {
    const points = projectNetWorth(
      input({
        horizonYears: 1,
        superInput: { ...flatSuper, currentBalanceCents: 40_000_00 },
        otherCents: 10_000_00,
        equityGrants: [vestedShares(1000, 5_00)],
        helpCentsByYear: [15_000_00, 15_000_00],
      }),
    )
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
