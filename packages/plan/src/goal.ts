/**
 * Goal projection: progress and ETA toward a savings target from a current
 * balance and a fortnightly contribution.
 */

import type { Money, SavingsGoal } from './index.ts'

/** Milliseconds in a fortnight; ETAs advance by whole fortnights. */
const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000

/** Fortnights in a year; the modelled rate compounds once per fortnight. */
const FORTNIGHTS_PER_YEAR = 26

/**
 * Upper bound on the fortnight-by-fortnight walk (~200 years). A goal that has
 * not reached its target by then stays `null`, as an unreachable goal does.
 */
const MAX_FORTNIGHTS = 5200

/**
 * A goal's projected trajectory. `remainingCents` is what is still to be saved;
 * `alreadyMet` is true when the target is already reached. `fortnightsToTarget`
 * and `projectedCompletionDate` are the count of fortnights and the ISO date the
 * contribution reaches the target — both null when a zero (or negative)
 * contribution can never reach it. `requiredFortnightlyContributionCents` is the
 * contribution needed to hit a set `targetDate`, or null when the goal has none.
 */
export interface GoalProjection {
  readonly remainingCents: Money
  readonly alreadyMet: boolean
  readonly fortnightsToTarget: number | null
  readonly projectedCompletionDate: string | null
  readonly requiredFortnightlyContributionCents: Money | null
}

/** Formats a Date as its ISO date part (YYYY-MM-DD). */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The per-fortnight growth factor `f` for a goal's modelled interest: the
 * entered figure is the effective annual rate, so `f = (1 + bps/10000) ^ (1/26)`.
 * A null, zero, or negative rate gives `f = 1` — no growth, and the projection
 * collapses to pure linear contribution math.
 */
function fortnightGrowthFactor(annualInterestBps: number | null | undefined): number {
  if (annualInterestBps == null || annualInterestBps <= 0) {
    return 1
  }
  return (1 + annualInterestBps / 10_000) ** (1 / FORTNIGHTS_PER_YEAR)
}

/**
 * Walks the balance forward fortnight by fortnight — grow by `f`, then add the
 * contribution, rounding to whole cents — until it reaches `targetCents`.
 * Returns the fortnight count, or null if the target is not reached within
 * `MAX_FORTNIGHTS`. Used only when `f > 1`; with growth a zero or negative
 * contribution can still reach the target, so the walk does not short-circuit
 * on the contribution's sign.
 */
function fortnightsToTargetWithGrowth(
  startBalanceCents: Money,
  targetCents: Money,
  fortnightlyContributionCents: Money,
  f: number,
): number | null {
  let balanceCents = startBalanceCents
  for (let fortnights = 1; fortnights <= MAX_FORTNIGHTS; fortnights += 1) {
    balanceCents = Math.round(balanceCents * f + fortnightlyContributionCents)
    if (balanceCents >= targetCents) {
      return fortnights
    }
  }
  return null
}

/**
 * Projects a goal at `now`. Remaining is `max(0, target − current)`; a met goal
 * completes at `now` in zero fortnights. Otherwise the fortnights to the target
 * and the completion date come from the fortnightly contribution — and, when the
 * goal models an interest rate, from fortnightly compounding on the running
 * balance. Without a rate a positive contribution gives `ceil(remaining /
 * contribution)` fortnights and a non-positive one leaves both null; with a rate
 * the balance is stepped forward `balance = balance · f + contribution` until it
 * reaches the target (null past ~200 years). When the goal has a `targetDate`,
 * the required fortnightly contribution to meet it is the closed-form annuity
 * `(target − balance₀·fⁿ)·(f − 1)/(fⁿ − 1)` (rounded up), collapsing to
 * `ceil(remaining / fortnights until the date)` with no rate and to the full
 * remaining amount when the date is already at or past `now`. `now` is taken as
 * a parameter for deterministic results.
 */
export function projectGoal(
  goal: SavingsGoal,
  fortnightlyContributionCents: Money,
  now: Date,
): GoalProjection {
  const currentBalanceCents = goal.currentBalanceCents
  const remainingCents = Math.max(0, goal.targetAmountCents - currentBalanceCents)
  const alreadyMet = remainingCents === 0
  const f = fortnightGrowthFactor(goal.annualInterestBps)

  let fortnightsToTarget: number | null
  let projectedCompletionDate: string | null
  if (alreadyMet) {
    fortnightsToTarget = 0
    projectedCompletionDate = isoDate(now)
  } else if (f > 1) {
    fortnightsToTarget = fortnightsToTargetWithGrowth(
      currentBalanceCents,
      goal.targetAmountCents,
      fortnightlyContributionCents,
      f,
    )
    projectedCompletionDate =
      fortnightsToTarget === null
        ? null
        : isoDate(new Date(now.getTime() + fortnightsToTarget * FORTNIGHT_MS))
  } else if (fortnightlyContributionCents > 0) {
    fortnightsToTarget = Math.ceil(remainingCents / fortnightlyContributionCents)
    projectedCompletionDate = isoDate(new Date(now.getTime() + fortnightsToTarget * FORTNIGHT_MS))
  } else {
    fortnightsToTarget = null
    projectedCompletionDate = null
  }

  let requiredFortnightlyContributionCents: Money | null = null
  if (goal.targetDate !== undefined) {
    if (alreadyMet) {
      requiredFortnightlyContributionCents = 0
    } else {
      const fortnightsLeft = Math.ceil((Date.parse(goal.targetDate) - now.getTime()) / FORTNIGHT_MS)
      if (fortnightsLeft <= 0) {
        requiredFortnightlyContributionCents = remainingCents
      } else if (f > 1) {
        const growthOverTerm = f ** fortnightsLeft
        const annuity =
          ((goal.targetAmountCents - currentBalanceCents * growthOverTerm) * (f - 1)) /
          (growthOverTerm - 1)
        requiredFortnightlyContributionCents = Math.max(0, Math.ceil(annuity))
      } else {
        requiredFortnightlyContributionCents = Math.ceil(remainingCents / fortnightsLeft)
      }
    }
  }

  return {
    remainingCents,
    alreadyMet,
    fortnightsToTarget,
    projectedCompletionDate,
    requiredFortnightlyContributionCents,
  }
}
