import { describe, expect, it } from 'vitest'
import type { HelpPayoffProjection } from '@nest/tax'
import type { Account } from '../hooks/useAccounts'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal } from '../hooks/useGoals'
import {
  combinedHelpCentsByYear,
  DEFAULT_PROJECTION_HORIZON_YEARS,
  netWorthGoals,
  projectionHorizonYears,
  resolveHorizonYears,
  splitCashAndDebt,
} from './netWorth'

/** A payoff projection whose only meaningful field here is the closing-balance schedule. */
function payoff(closingBalancesCents: number[]): HelpPayoffProjection {
  return {
    paidOffFinancialYear: null,
    yearsToPayOff: null,
    schedule: closingBalancesCents.map((closingBalanceCents, index) => ({
      financialYear: 2027 + index,
      openingBalanceCents: 0,
      indexationCents: 0,
      repaymentCents: 0,
      closingBalanceCents,
    })),
  }
}

describe('projectionHorizonYears', () => {
  it('takes the longest span to retirement across known ages', () => {
    expect(projectionHorizonYears([40, 30], 60)).toBe(30)
  })

  it('falls back to the default when no age is known', () => {
    expect(projectionHorizonYears([], 60)).toBe(DEFAULT_PROJECTION_HORIZON_YEARS)
  })

  it('falls back to the default when every known member is past retirement', () => {
    expect(projectionHorizonYears([62, 65], 60)).toBe(DEFAULT_PROJECTION_HORIZON_YEARS)
  })
})

describe('resolveHorizonYears', () => {
  it('maps each fixed option to its year count', () => {
    expect(resolveHorizonYears('5y', 42)).toBe(5)
    expect(resolveHorizonYears('10y', 42)).toBe(10)
    expect(resolveHorizonYears('20y', 42)).toBe(20)
    expect(resolveHorizonYears('30y', 42)).toBe(30)
  })

  it('uses the retirement-derived horizon for the "retirement" option', () => {
    expect(resolveHorizonYears('retirement', 42)).toBe(42)
  })
})

describe('combinedHelpCentsByYear', () => {
  it('sums each member closing balance per year, starting from the current total', () => {
    const result = combinedHelpCentsByYear(
      [payoff([20_000_00, 10_000_00, 0]), payoff([5_000_00, 0])],
      35_000_00,
      3,
    )
    // Year 0 = current total; later years sum the members' closing balances, with a
    // cleared/ended schedule contributing zero.
    expect(result).toEqual([35_000_00, 25_000_00, 10_000_00, 0])
  })

  it('returns a flat current total when there are no debts', () => {
    expect(combinedHelpCentsByYear([], 0, 2)).toEqual([0, 0, 0])
  })
})

/** A savings-goal row carrying only the fields the projection reads. */
function goal(overrides: Partial<Goal> & Pick<Goal, 'id'>): Goal {
  return {
    target_amount_cents: 10_000_00,
    current_balance_cents: 0,
    linked_account_id: null,
    ...overrides,
  } as Goal
}

/** A budget line funding a goal at a fortnightly amount. */
function line(goalId: string, amountCents: number): BudgetLine {
  return { goal_id: goalId, amount_cents: amountCents, frequency: 'fortnightly' } as BudgetLine
}

describe('netWorthGoals', () => {
  it('sums the fortnightly contribution from the budget lines routed to a goal', () => {
    const goals = [goal({ id: 'g1', target_amount_cents: 20_000_00 })]
    const lines = [line('g1', 60_00), line('g1', 40_00), line('g2', 999_00)]
    expect(netWorthGoals(goals, lines, new Map())).toEqual([
      {
        targetAmountCents: 20_000_00,
        currentBalanceCents: 0,
        fortnightlyContributionCents: 100_00,
      },
    ])
  })

  it('uses a linked saver synced balance over the manual figure', () => {
    const goals = [goal({ id: 'g1', linked_account_id: 'acc1', current_balance_cents: 1_000_00 })]
    expect(netWorthGoals(goals, [], new Map([['acc1', 7_500_00]]))).toEqual([
      {
        targetAmountCents: 10_000_00,
        currentBalanceCents: 7_500_00,
        fortnightlyContributionCents: 0,
      },
    ])
  })

  it('falls back to the manual balance when the linked account is not visible', () => {
    const goals = [goal({ id: 'g1', linked_account_id: 'hidden', current_balance_cents: 2_000_00 })]
    expect(netWorthGoals(goals, [], new Map())[0]?.currentBalanceCents).toBe(2_000_00)
  })
})

/** An account carrying only the balance the split reads. */
function balance(balanceCents: number): Account {
  return { balance_cents: balanceCents } as Account
}

describe('splitCashAndDebt', () => {
  it('sums non-negative balances into cash and negative balances into debt', () => {
    const split = splitCashAndDebt([balance(8_000_00), balance(0), balance(-1_500_00)])
    // Cash = 8_000 + 0; debt is the magnitude of the −1_500 balance.
    expect(split).toEqual({ cashCents: 8_000_00, debtCents: 1_500_00 })
  })

  it('is all zero for no accounts', () => {
    expect(splitCashAndDebt([])).toEqual({ cashCents: 0, debtCents: 0 })
  })
})
