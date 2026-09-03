/**
 * Net worth projected forward: a year-by-year series of the household's asset
 * components (super, cash and other accounts, vested equity) and its itemised
 * liabilities (HELP debt, debt accounts), and the resulting total. Pure and
 * deterministic — `asOf` and every assumption are passed in, never read from the
 * clock. Figures are nominal (future dollars): super compounds and accrues
 * contributions, cash starts flat and grows by ongoing savings-goal contributions,
 * equity grows only as it vests at today's price, HELP follows a supplied paydown,
 * and debt-account balances are held flat.
 */

import { equityTotalCents, type EquityGrant } from './equity.ts'
import { projectGoal } from './goal.ts'
import type { Money } from './index.ts'
import { FORTNIGHTS_PER_YEAR } from './normalize.ts'
import { projectSuperBalance } from './retirement.ts'

/**
 * The super side of the projection, aggregated across members: because the
 * growing-annuity math is linear in balance and contribution, one balance and one
 * contribution under shared rates reproduce the sum of the per-member projections.
 * Rates are decimals (0.07 = 7%).
 */
export interface NetWorthSuperInput {
  readonly currentBalanceCents: Money
  readonly annualContributionCents: Money
  readonly nominalReturnRate: number
  readonly contributionGrowthRate: number
}

/**
 * A savings goal folded into the projection's cash component. Its
 * `currentBalanceCents` is assumed already counted in `otherCents` (its linked
 * saver's synced balance, or the money a manual goal is saved in), so only future
 * contributions are added on top — never the current balance. Contributions accrue
 * at `fortnightlyContributionCents` and stop once the target is reached.
 */
export interface NetWorthGoal {
  readonly targetAmountCents: Money
  readonly currentBalanceCents: Money
  readonly fortnightlyContributionCents: Money
}

/**
 * Inputs to the net worth projection. `horizonYears` is the whole number of years
 * to project past `asOf`. `otherCents` is the current total of non-negative
 * non-super account balances (cash), which grows only by the `savingsGoals`
 * contributions folded on top. `debtCents` is the positive magnitude of the
 * negative-balance accounts (credit cards, loans), held flat. `equityGrants` are
 * valued at each future year so vesting lifts the equity line. `helpCentsByYear` is
 * the total HELP balance at each year offset (index 0 = as of `asOf`); a shorter
 * array reuses its last entry, an empty one means no debt.
 */
export interface NetWorthProjectionInput {
  readonly asOf: Date
  readonly horizonYears: number
  readonly superInput: NetWorthSuperInput
  readonly otherCents: Money
  readonly equityGrants: readonly EquityGrant[]
  readonly helpCentsByYear: readonly Money[]
  readonly savingsGoals: readonly NetWorthGoal[]
  readonly debtCents: Money
}

/**
 * One year of the projection. The asset bands (`superCents`, `otherCents` cash,
 * `equityCents`) and the liability bands (`helpCents`, `debtCents`) are each a
 * positive magnitude; `totalCents` is the assets less the liabilities.
 */
export interface NetWorthProjectionPoint {
  readonly year: number
  readonly superCents: Money
  readonly otherCents: Money
  readonly equityCents: Money
  readonly helpCents: Money
  readonly debtCents: Money
  readonly totalCents: Money
}

/** The `helpCentsByYear` entry for `year`, reusing the last entry past its end. */
function helpAt(helpCentsByYear: readonly Money[], year: number): Money {
  const lastIndex = helpCentsByYear.length - 1
  if (lastIndex < 0) {
    return 0
  }
  return helpCentsByYear[Math.min(year, lastIndex)]!
}

/** A copy of `date` advanced by whole `years`. */
function addYears(date: Date, years: number): Date {
  const next = new Date(date)
  next.setFullYear(next.getFullYear() + years)
  return next
}

/**
 * A goal's future saving, reduced to what still accrues: `remainingCents` — the
 * amount left to the target (`projectGoal`), which caps the contributions — and
 * `annualContributionCents`, the goal's fortnightly funding annualised.
 */
interface GoalAccrual {
  readonly remainingCents: Money
  readonly annualContributionCents: Money
}

/** Reduces each goal to its remaining-to-target cap and annualised contribution. */
function goalAccruals(goals: readonly NetWorthGoal[], asOf: Date): GoalAccrual[] {
  return goals.map((goal) => ({
    remainingCents: projectGoal(
      { targetAmountCents: goal.targetAmountCents, currentBalanceCents: goal.currentBalanceCents },
      goal.fortnightlyContributionCents,
      asOf,
    ).remainingCents,
    annualContributionCents: goal.fortnightlyContributionCents * FORTNIGHTS_PER_YEAR,
  }))
}

/**
 * The total future savings-goal contributions accrued by `year`, each goal capped
 * at its remaining-to-target amount so a goal stops adding once it is met.
 */
function goalsSavedByYear(accruals: readonly GoalAccrual[], year: number): Money {
  return accruals.reduce(
    (total, accrual) =>
      total + Math.min(accrual.remainingCents, Math.max(0, accrual.annualContributionCents * year)),
    0,
  )
}

/**
 * Projects net worth for each year from 0 (as of `asOf`) through `horizonYears`.
 * Super is compounded and accrued via `projectSuperBalance` in nominal terms (so
 * inflation is not applied); cash starts at `otherCents` and grows by the
 * `savingsGoals` contributions accrued to that year (each capped at its
 * remaining-to-target); equity is the vested value of the grants at that future
 * date; HELP is read from `helpCentsByYear`; debt accounts stay at `debtCents`. The
 * total is the asset bands (super, cash, equity) less the liability bands (HELP,
 * debt). A `horizonYears` below 0 yields the single year-0 point.
 */
export function projectNetWorth(input: NetWorthProjectionInput): NetWorthProjectionPoint[] {
  const {
    asOf,
    horizonYears,
    superInput,
    otherCents,
    equityGrants,
    helpCentsByYear,
    savingsGoals,
    debtCents,
  } = input
  const lastYear = Math.max(0, Math.floor(horizonYears))
  const accruals = goalAccruals(savingsGoals, asOf)
  const points: NetWorthProjectionPoint[] = []
  for (let year = 0; year <= lastYear; year++) {
    const superCents = projectSuperBalance({
      currentBalanceCents: superInput.currentBalanceCents,
      annualContributionCents: superInput.annualContributionCents,
      years: year,
      nominalReturnRate: superInput.nominalReturnRate,
      inflationRate: 0,
      contributionGrowthRate: superInput.contributionGrowthRate,
    }).nominalCents
    const cashCents = otherCents + goalsSavedByYear(accruals, year)
    const equityCents = equityTotalCents(equityGrants, addYears(asOf, year))
    const helpCents = helpAt(helpCentsByYear, year)
    points.push({
      year,
      superCents,
      otherCents: cashCents,
      equityCents,
      helpCents,
      debtCents,
      totalCents: superCents + cashCents + equityCents - helpCents - debtCents,
    })
  }
  return points
}
