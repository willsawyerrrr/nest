import { fortnightlyCents, type NetWorthGoal } from '@nest/plan'
import type { HelpPayoffProjection } from '@nest/tax'
import type { Account } from '../hooks/useAccounts'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal } from '../hooks/useGoals'
import type { ProjectionHorizonOption } from './retirement'

/** Default projection horizon in years when no member age pins it to retirement. */
export const DEFAULT_PROJECTION_HORIZON_YEARS = 30

/**
 * The projection horizon in whole years: the longest span to `retirementAge`
 * across members whose age is known, or `DEFAULT_PROJECTION_HORIZON_YEARS` when
 * none is known (or every known member is already at or past retirement).
 */
export function projectionHorizonYears(ages: readonly number[], retirementAge: number): number {
  const spans = ages.map((age) => Math.round(retirementAge - age)).filter((years) => years > 0)
  return spans.length > 0 ? Math.max(...spans) : DEFAULT_PROJECTION_HORIZON_YEARS
}

/** Whole-year length of each fixed horizon option. */
const FIXED_HORIZON_YEARS: Record<Exclude<ProjectionHorizonOption, 'retirement'>, number> = {
  '5y': 5,
  '10y': 10,
  '20y': 20,
  '30y': 30,
}

/**
 * The horizon in whole years for the selected option: a fixed span, or the
 * retirement-age-derived `retirementHorizonYears` when `retirement` is chosen.
 */
export function resolveHorizonYears(
  option: ProjectionHorizonOption,
  retirementHorizonYears: number,
): number {
  return option === 'retirement' ? retirementHorizonYears : FIXED_HORIZON_YEARS[option]
}

/**
 * The household's total HELP balance at each projected year (index 0 = now),
 * combining the members' payoff schedules: year 0 is `currentTotalCents`, and each
 * later year sums each member's closing balance for that year (0 once a schedule
 * has cleared or ended). Runs to `horizonYears`.
 */
export function combinedHelpCentsByYear(
  payoffs: Iterable<HelpPayoffProjection>,
  currentTotalCents: number,
  horizonYears: number,
): number[] {
  const schedules = [...payoffs].map((payoff) => payoff.schedule)
  const result = [currentTotalCents]
  for (let year = 1; year <= horizonYears; year++) {
    let sum = 0
    for (const schedule of schedules) {
      sum += schedule[year - 1]?.closingBalanceCents ?? 0
    }
    result.push(sum)
  }
  return result
}

/**
 * Maps the household's savings goals to the projection's goal shape. Each goal's
 * effective current balance is its linked saver's synced balance (from
 * `balanceByAccountId`, falling back to the manual figure when the account is not
 * visible) or, for an unlinked goal, its manually entered balance — the same
 * balance the Goals tab shows. The fortnightly contribution is the sum of the
 * budget lines routed to the goal, matching the Goals tab's funding rate.
 */
export function netWorthGoals(
  goals: readonly Goal[],
  lines: readonly BudgetLine[],
  balanceByAccountId: ReadonlyMap<string, number>,
): NetWorthGoal[] {
  return goals.map((goal) => {
    const currentBalanceCents =
      goal.linked_account_id !== null
        ? (balanceByAccountId.get(goal.linked_account_id) ?? goal.current_balance_cents)
        : goal.current_balance_cents
    const fortnightlyContributionCents = lines
      .filter((line) => line.goal_id === goal.id)
      .reduce((total, line) => total + fortnightlyCents(line.amount_cents, line.frequency), 0)
    return {
      targetAmountCents: goal.target_amount_cents,
      currentBalanceCents,
      fortnightlyContributionCents,
    }
  })
}

/** The cash (non-negative balances) and debt (magnitude of negative balances) split. */
export interface CashDebtSplit {
  cashCents: number
  debtCents: number
}

/**
 * Splits accounts into cash and debt: positive balances sum into `cashCents`, while
 * negative balances (credit cards, loans) sum, as a positive magnitude, into
 * `debtCents`. Pass the net-worth-included, non-super accounts so a debt account
 * surfaces as its own liability rather than sinking the cash total.
 */
export function splitCashAndDebt(accounts: readonly Account[]): CashDebtSplit {
  let cashCents = 0
  let debtCents = 0
  for (const account of accounts) {
    if (account.balance_cents < 0) {
      debtCents -= account.balance_cents
    } else {
      cashCents += account.balance_cents
    }
  }
  return { cashCents, debtCents }
}
