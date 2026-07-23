/**
 * Net worth projected forward: a year-by-year series of the household's asset
 * components (super, cash and other accounts, vested equity) less its HELP debt,
 * and the resulting total. Pure and deterministic — `asOf` and every assumption
 * are passed in, never read from the clock. Figures are nominal (future dollars):
 * super compounds and accrues contributions, cash is held flat, equity grows only
 * as it vests at today's price, and HELP follows a supplied paydown.
 */

import { equityTotalCents, type EquityGrant } from './equity'
import type { Money } from './index'
import { projectSuperBalance } from './retirement'

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
 * Inputs to the net worth projection. `horizonYears` is the whole number of years
 * to project past `asOf`. `otherCents` is the current total of non-super accounts,
 * held flat. `equityGrants` are valued at each future year so vesting lifts the
 * equity line. `helpCentsByYear` is the total HELP balance at each year offset
 * (index 0 = as of `asOf`); a shorter array reuses its last entry, an empty one
 * means no debt.
 */
export interface NetWorthProjectionInput {
  readonly asOf: Date
  readonly horizonYears: number
  readonly superInput: NetWorthSuperInput
  readonly otherCents: Money
  readonly equityGrants: readonly EquityGrant[]
  readonly helpCentsByYear: readonly Money[]
}

/** One year of the projection: each component and the resulting total, in cents. */
export interface NetWorthProjectionPoint {
  readonly year: number
  readonly superCents: Money
  readonly otherCents: Money
  readonly equityCents: Money
  readonly helpCents: Money
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
 * Projects net worth for each year from 0 (as of `asOf`) through `horizonYears`.
 * Super is compounded and accrued via `projectSuperBalance` in nominal terms (so
 * inflation is not applied); cash stays at `otherCents`; equity is the vested value
 * of the grants at that future date; HELP is read from `helpCentsByYear`. The total
 * is super plus cash plus equity less HELP. A `horizonYears` below 0 yields the
 * single year-0 point.
 */
export function projectNetWorth(input: NetWorthProjectionInput): NetWorthProjectionPoint[] {
  const { asOf, horizonYears, superInput, otherCents, equityGrants, helpCentsByYear } = input
  const lastYear = Math.max(0, Math.floor(horizonYears))
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
    const equityCents = equityTotalCents(equityGrants, addYears(asOf, year))
    const helpCents = helpAt(helpCentsByYear, year)
    points.push({
      year,
      superCents,
      otherCents,
      equityCents,
      helpCents,
      totalCents: superCents + otherCents + equityCents - helpCents,
    })
  }
  return points
}
