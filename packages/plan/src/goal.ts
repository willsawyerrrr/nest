/**
 * Goal projection: progress and ETA toward a savings target from a current
 * balance and a fortnightly contribution.
 */

import type { Money, SavingsGoal } from './index'

/** Milliseconds in a fortnight; ETAs advance by whole fortnights. */
const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000

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
 * Projects a goal at `now`. Remaining is `max(0, target − current)`; a met goal
 * completes at `now` in zero fortnights. Otherwise a positive contribution gives
 * `ceil(remaining / contribution)` fortnights and a completion date that many
 * fortnights out, while a non-positive contribution leaves both null. When the
 * goal has a `targetDate`, the required fortnightly contribution to meet it is
 * `ceil(remaining / fortnights until the date)`, collapsing to the full
 * remaining amount when the date is already at or past `now`. `now` is taken as
 * a parameter for deterministic results.
 */
export function projectGoal(
  goal: SavingsGoal,
  fortnightlyContributionCents: Money,
  now: Date,
): GoalProjection {
  const remainingCents = Math.max(0, goal.targetAmountCents - goal.currentBalanceCents)
  const alreadyMet = remainingCents === 0

  let fortnightsToTarget: number | null
  let projectedCompletionDate: string | null
  if (alreadyMet) {
    fortnightsToTarget = 0
    projectedCompletionDate = isoDate(now)
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
      requiredFortnightlyContributionCents =
        fortnightsLeft > 0 ? Math.ceil(remainingCents / fortnightsLeft) : remainingCents
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
