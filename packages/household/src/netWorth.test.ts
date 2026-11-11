import { describe, expect, it } from 'vitest'
import type { HelpPayoffProjection } from '@nest/tax'
import {
  combinedHelpCentsByYear,
  DEFAULT_PROJECTION_HORIZON_YEARS,
  homeLoanLiabilities,
  netWorthBreakdown,
  netWorthGoals,
  netWorthOfRows,
  projectionHorizonYears,
  resolveHorizonYears,
  splitCashAndDebt,
  superAccountIds,
  type NetWorthAccountRow,
  type NetWorthRows,
} from './netWorth.ts'
import { equityGrantToPlan, grantHoldings, heldEquityHoldings } from './netWorthEquity.ts'

const NOW = new Date('2026-12-01T00:00:00Z')

const account = (
  id: string,
  type: string,
  balance: number,
  excluded = false,
): NetWorthAccountRow => ({
  id,
  name: id,
  type,
  balance_cents: balance,
  exclude_from_net_worth: excluded,
})

const grant = {
  id: 'g1',
  member_id: 'm1',
  label: 'Options',
  instrument_type: 'option',
  quantity: 1_000,
  grant_date: '2024-01-01',
  cliff_months: 12,
  vesting_period_months: 48,
  vesting_frequency: 'monthly',
  strike_price_cents: 100,
  price_per_share_cents: 300,
}

const units = (id: string, quantity: number) => ({ id, grant_id: 'g1', quantity })

function rows(overrides: Partial<NetWorthRows> = {}): NetWorthRows {
  return {
    accounts: [
      account('cash', 'transaction', 5_000_00),
      account('super', 'other', 50_000_00),
      account('loan', 'home_loan', -200_000_00),
      account('card', 'credit', -500_00),
      account('hidden', 'savings', 1_000_00, true),
    ],
    superProfiles: [
      { member_id: 'm1', linked_account_id: 'super', balance_as_of: '2026-06-30' },
      { member_id: 'm2', linked_account_id: null, balance_as_of: null },
    ],
    contributions: [],
    taxProfiles: [],
    helpDebts: [
      { member_id: 'm1', balance_cents: 10_000_00 },
      { member_id: 'm2', balance_cents: 0 },
    ],
    deductions: [],
    members: [
      { id: 'm1', name: 'Ada', date_of_birth: null },
      { id: 'm2', name: 'Ben', date_of_birth: null },
    ],
    inflows: [
      {
        member_id: 'm1',
        taxable: true,
        type: 'salary',
        schedule: 'annual',
        amount_cents: 100_000_00,
        hourly_rate_cents: null,
        hours_per_period: null,
        interval_count: null,
        starts_on: null,
        ends_on: null,
        paid_on: null,
        attracts_super: true,
        one_off_tax_treatment: null,
        years_of_service: null,
        is_joint: false,
        member_split_percent: null,
      },
    ],
    goals: [],
    budgetLines: [],
    equityGrants: [grant, { ...grant, id: 'g2', member_id: 'm9', label: 'Zero', quantity: 0 }],
    equityExercises: [units('e1', 100)],
    equitySales: [units('s1', 50)],
    trades: [
      {
        member_id: 'm1',
        ticker: 'VAS',
        side: 'buy',
        traded_on: '2025-01-01',
        units: 10,
        price_per_unit_microdollars: 90_000_000,
        fee_cents: 0,
      },
      {
        member_id: 'm9',
        ticker: 'NDQ',
        side: 'buy',
        traded_on: '2025-01-01',
        units: 1,
        price_per_unit_microdollars: 90_000_000,
        fee_cents: 0,
      },
    ],
    horizon: '5y',
    now: NOW,
    ...overrides,
  }
}

describe('netWorthOfRows', () => {
  it('labels liabilities and holdings by member and totals assets less liabilities', () => {
    const { breakdown, projection, projectionBaseYear } = netWorthOfRows(rows())
    expect(breakdown.liabilities.map((l) => l.label)).toEqual(['loan', "Ada's HELP debt"])
    expect(breakdown.excludedAccounts.map((a) => a.id)).toEqual(['hidden'])
    expect(breakdown.equityHoldings.map((h) => h.label)).toEqual([
      'Ada — Options',
      'Ada — VAS',
      'Unknown — NDQ',
    ])
    expect(breakdown.totalCents).toBe(
      breakdown.superTotalCents +
        breakdown.otherTotalCents +
        breakdown.equityTotalCents -
        breakdown.liabilitiesTotalCents,
    )
    expect(projection).toHaveLength(6)
    expect(projectionBaseYear).toBe(2026)
  })

  it('runs to the retirement horizon from known ages and custom assumptions', () => {
    const assumptions = {
      retirementAge: 60,
      expectedReturnPct: 5,
      inflationPct: 2,
      contributionGrowthPct: 1,
    }
    const { projection } = netWorthOfRows(
      rows({ horizon: 'retirement', ages: { m1: 40 }, assumptions }),
    )
    expect(projection).toHaveLength(21)
  })

  it('falls back to the latest published tax config past the last year', () => {
    const { projection } = netWorthOfRows(rows({ now: new Date('2060-01-01T00:00:00Z') }))
    expect(projection).toHaveLength(6)
  })

  it('treats an absent or unlinked profile as unchanged and a saver-less goal as manual', () => {
    const { breakdown } = netWorthOfRows(
      rows({
        superProfiles: [
          { member_id: 'm3', linked_account_id: 'super', balance_as_of: undefined as never },
        ],
        goals: [
          {
            id: 'g',
            linked_account_id: undefined as never,
            current_balance_cents: 1,
            target_amount_cents: 100,
            queue_position: null,
            planned_contribution_cents: null,
          },
        ],
      }),
    )
    expect(breakdown.superTotalCents).toBe(50_000_00)
  })
})

describe('the net worth helpers', () => {
  it('finds super accounts, home loans and cash against debt', () => {
    expect(superAccountIds([{ linked_account_id: 'a' }, { linked_account_id: null }])).toEqual(
      new Set(['a']),
    )
    const accounts = [account('l', 'home_loan', -100), account('x', 'home_loan', -50, true)]
    expect(homeLoanLiabilities(accounts)).toEqual([{ label: 'l', balanceCents: 100 }])
    expect(splitCashAndDebt([account('a', 'other', 30), account('b', 'credit', -20)])).toEqual({
      cashCents: 30,
      debtCents: 20,
    })
    expect(netWorthBreakdown(accounts, new Set()).liabilitiesTotalCents).toBe(100)
  })

  it('resolves the horizon', () => {
    expect(projectionHorizonYears([], 60)).toBe(DEFAULT_PROJECTION_HORIZON_YEARS)
    expect(projectionHorizonYears([40, 70], 60)).toBe(20)
    expect(resolveHorizonYears('retirement', 12)).toBe(12)
    expect(resolveHorizonYears('10y', 12)).toBe(10)
  })

  it('combines HELP schedules by year', () => {
    const payoff = {
      schedule: [{ closingBalanceCents: 80 }, { closingBalanceCents: 40 }],
    } as unknown as HelpPayoffProjection
    expect(combinedHelpCentsByYear([payoff, payoff], 200, 3)).toEqual([200, 160, 80, 0])
  })

  it('funds goals from their lines and a linked saver balance', () => {
    const goal = {
      id: 'g',
      linked_account_id: 'a',
      current_balance_cents: 5,
      target_amount_cents: 100,
      queue_position: 1,
      planned_contribution_cents: 7,
    }
    const lines = [{ goal_id: 'g', amount_cents: 26_00, frequency: 'annual' }]
    expect(netWorthGoals([goal], lines, new Map([['a', 40]]))[0]).toMatchObject({
      currentBalanceCents: 40,
      fortnightlyContributionCents: 1_00,
      queuePosition: 1,
      plannedContributionCents: 7,
    })
    expect(netWorthGoals([goal], lines, new Map())[0]?.currentBalanceCents).toBe(5)
  })
})

describe('the equity helpers', () => {
  it('counts exercised, sold and sellable units, leaving one row out when asked', () => {
    expect(grantHoldings(grant, [units('e1', 100)], [units('s1', 50)])).toEqual({
      exercised: 100,
      sold: 50,
      unexercised: 900,
      sellable: 50,
    })
    expect(grantHoldings(grant, [units('e1', 100)], [], 'e1').exercised).toBe(0)
    expect(grantHoldings({ ...grant, instrument_type: 'share' }, [], [units('s1', 5)])).toEqual({
      exercised: 0,
      sold: 5,
      unexercised: 0,
      sellable: 995,
    })
  })

  it('maps a grant to the plan shape and drops fully sold holdings', () => {
    expect(equityGrantToPlan(grant)).toMatchObject({ exercisedQuantity: 0, soldQuantity: 0 })
    expect(
      equityGrantToPlan({ ...grant, strike_price_cents: undefined as never }).strikePriceCents,
    ).toBeNull()
    const sold = [
      {
        member_id: 'm1',
        ticker: 'A',
        side: 'buy',
        traded_on: '2025-01-01',
        units: 1,
        price_per_unit_microdollars: 1_000_000,
        fee_cents: 0,
      },
      {
        member_id: 'm1',
        ticker: 'A',
        side: 'sell',
        traded_on: '2025-02-01',
        units: 1,
        price_per_unit_microdollars: 1_000_000,
        fee_cents: 0,
      },
    ]
    expect(heldEquityHoldings(sold, [{ id: 'm1', name: 'Ada' }])).toEqual([])
  })
})
