/**
 * Retirement projection: the future value of a super balance at retirement, from
 * the current balance plus a growing stream of annual contributions, in both
 * nominal and today's (real) dollars.
 */

import type { Money } from './index'

/**
 * The inputs to a super projection. `years` is the whole number of years the
 * balance grows for (passed in, so the projection is deterministic). Rates are
 * decimals (0.07 = 7%): `nominalReturnRate` is the fund's return, `inflationRate`
 * deflates the nominal result to today's dollars, and `contributionGrowthRate` is
 * the year-on-year growth of the annual contribution.
 */
export interface SuperProjectionInput {
  readonly currentBalanceCents: Money
  readonly annualContributionCents: Money
  readonly years: number
  readonly nominalReturnRate: number
  readonly inflationRate: number
  readonly contributionGrowthRate: number
}

/** A projected balance at retirement, in nominal and today's (real) dollars. */
export interface SuperProjection {
  readonly nominalCents: Money
  readonly realCents: Money
}

/**
 * Future value of a growing annuity: `years` end-of-year contributions, the first
 * of `contributionCents`, each subsequent one larger by `growthRate`, every one
 * invested at `returnRate` until retirement. Uses the closed form
 * `C · ((1+r)^n − (1+g)^n) / (r − g)`, falling back to `C · n · (1+r)^(n−1)` when
 * `r` equals `g` (the closed form's removable singularity).
 */
function growingAnnuityFv(
  contributionCents: number,
  years: number,
  returnRate: number,
  growthRate: number,
): number {
  if (years <= 0 || contributionCents === 0) {
    return 0
  }
  const r = 1 + returnRate
  const g = 1 + growthRate
  if (returnRate === growthRate) {
    return contributionCents * years * r ** (years - 1)
  }
  return (contributionCents * (r ** years - g ** years)) / (returnRate - growthRate)
}

/**
 * Projects a super balance forward `years` years. The current balance compounds
 * at `nominalReturnRate`; contributions accumulate as a growing annuity (growing
 * at `contributionGrowthRate`, invested at `nominalReturnRate`). The nominal total
 * is deflated by `inflationRate` over the same period for the real figure. With
 * `years ≤ 0` both figures are the current balance. Output is integer cents.
 */
export function projectSuperBalance(input: SuperProjectionInput): SuperProjection {
  const {
    currentBalanceCents,
    annualContributionCents,
    years,
    nominalReturnRate,
    inflationRate,
    contributionGrowthRate,
  } = input

  if (years <= 0) {
    return { nominalCents: currentBalanceCents, realCents: currentBalanceCents }
  }

  const balanceFv = currentBalanceCents * (1 + nominalReturnRate) ** years
  const contributionsFv = growingAnnuityFv(
    annualContributionCents,
    years,
    nominalReturnRate,
    contributionGrowthRate,
  )
  const nominal = balanceFv + contributionsFv
  const real = nominal / (1 + inflationRate) ** years

  return { nominalCents: Math.round(nominal), realCents: Math.round(real) }
}
