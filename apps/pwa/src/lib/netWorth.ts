import {
  fortnightlyCents,
  projectNetWorth,
  type EquityGrant,
  type NetWorthGoal,
  type NetWorthProjectionPoint,
  type RetirementAssumptions,
} from '@nest/plan'
import type { HelpPayoffProjection } from '@nest/tax'
import type { Account } from '../hooks/useAccounts'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { DeductionRow } from '../hooks/useDeductions'
import type { Goal } from '../hooks/useGoals'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { Inflow } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { SuperContribution } from '../hooks/useSuperContributions'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import type { ProjectionHorizonOption } from './retirement'
import {
  accountsWithEffectiveSuperBalances,
  homeLoanLiabilities,
  netWorthBreakdown,
  superAccountIds,
  type EquityHolding,
  type Liability,
} from './super'
import {
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  netAnnualSuperContributionFromRows,
} from './tax'

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
      queuePosition: goal.queue_position,
      plannedContributionCents: goal.planned_contribution_cents,
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

/** The rows and settings a net-worth outcome is computed from. */
export interface NetWorthComputeInput {
  accounts: Account[]
  superProfiles: SuperProfile[]
  contributions: SuperContribution[]
  taxProfiles: TaxProfile[]
  helpDebts: HelpDebt[]
  deductions: DeductionRow[]
  members: readonly Pick<Member, 'id' | 'date_of_birth'>[]
  /** Equity grants already mapped to the plan's shape (`equityGrantToPlan`). */
  planGrants: EquityGrant[]
  /** Named liabilities (each member's HELP debt) subtracted from the total. */
  liabilities: Liability[]
  /** Vested equity holdings added to the total. */
  equity: EquityHolding[]
  inflows: Inflow[]
  goals: Goal[]
  budgetLines: BudgetLine[]
  assumptions: RetirementAssumptions
  /** The projection horizon in whole years. */
  horizonYears: number
  now: Date
}

/** A net-worth outcome: the accrual-adjusted accounts, the current total, and the projection. */
export interface NetWorthComputeResult {
  effectiveAccounts: Account[]
  totalCents: number
  projection: NetWorthProjectionPoint[]
}

/**
 * The current net worth and its forward projection from the household's rows.
 * The effective super balances accrue the modelled contributions the inflows
 * imply, so a sandbox inflow edit moves both the current total and the
 * projection; goal and budget-line edits move the projection through the
 * savings-goal contributions folded into it. Pure — the Net worth tab and the
 * planning roll-up both call it, once per row set, so their figures agree by
 * construction.
 */
export function computeNetWorth({
  accounts,
  superProfiles,
  contributions,
  taxProfiles,
  helpDebts,
  deductions,
  members,
  planGrants,
  liabilities,
  equity,
  inflows,
  goals,
  budgetLines,
  assumptions,
  horizonYears,
  now,
}: NetWorthComputeInput): NetWorthComputeResult {
  const superIds = superAccountIds(superProfiles)
  const netContributionByMember = netAnnualSuperContributionFromRows(
    inflows,
    contributions,
    members,
  )
  const effectiveAccounts = accountsWithEffectiveSuperBalances(
    accounts,
    superProfiles,
    netContributionByMember,
    now,
  )
  const breakdown = netWorthBreakdown(effectiveAccounts, superIds)
  const totalCents = netWorthBreakdown(effectiveAccounts, superIds, liabilities, equity).totalCents

  const estimate = estimateHouseholdTaxFromRows(
    inflows,
    taxProfiles,
    contributions,
    helpDebts,
    deductions,
    undefined,
    undefined,
    members,
  )
  const helpNowCents = helpDebts.reduce((total, debt) => total + Math.max(0, debt.balance_cents), 0)
  const helpCentsByYear = combinedHelpCentsByYear(
    helpPayoffByMember(estimate, helpDebts).values(),
    helpNowCents,
    horizonYears,
  )
  const totalNetContributionCents = [...netContributionByMember.values()].reduce(
    (total, cents) => total + cents,
    0,
  )
  const balanceByAccountId = new Map(
    effectiveAccounts.map((account) => [account.id, account.balance_cents]),
  )
  const savingsGoals = netWorthGoals(goals, budgetLines, balanceByAccountId)
  const { cashCents, debtCents } = splitCashAndDebt(breakdown.otherAccounts)
  // A home loan is split out of the accounts into its own liability, so its owed
  // amount joins the projection's debt band alongside the negative-balance
  // accounts and is held flat.
  const homeLoanDebtCents = homeLoanLiabilities(effectiveAccounts).reduce(
    (total, liability) => total + liability.balanceCents,
    0,
  )
  const projection = projectNetWorth({
    asOf: now,
    horizonYears,
    superInput: {
      currentBalanceCents: breakdown.superTotalCents,
      annualContributionCents: totalNetContributionCents,
      nominalReturnRate: assumptions.expectedReturnPct / 100,
      contributionGrowthRate: assumptions.contributionGrowthPct / 100,
    },
    otherCents: cashCents,
    equityGrants: planGrants,
    helpCentsByYear,
    savingsGoals,
    debtCents: debtCents + homeLoanDebtCents,
  })
  return { effectiveAccounts, totalCents, projection }
}
