/**
 * Shared savings-goal projection math: the fortnight constants, ISO date
 * formatting, the modelled-interest growth factor, and the closed-form
 * contribution a goal needs to hit a target within a window. `goal.ts`
 * (a single goal) and `goalQueue.ts` (the ordered queue) both build on these so
 * the rounding and the annuity cannot diverge between them.
 */

import type { Money, SavingsGoal } from './index.ts'
import { FORTNIGHTS_PER_YEAR } from './normalize.ts'

/** Milliseconds in a fortnight; ETAs advance by whole fortnights. */
export const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Upper bound on the fortnight-by-fortnight walk (~200 years). A goal that has
 * not reached its target by then stays `null`, as an unreachable goal does.
 */
export const MAX_FORTNIGHTS = 5200

/** Formats a Date as its ISO date part (YYYY-MM-DD). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The per-fortnight growth factor `f` for a goal's modelled interest: the
 * entered figure is the effective annual rate, so `f = (1 + bps/10000) ^ (1/26)`.
 * A null, zero, or negative rate gives `f = 1` — no growth, and the projection
 * collapses to pure linear contribution math.
 */
export function fortnightGrowthFactor(annualInterestBps: number | null | undefined): number {
  if (annualInterestBps == null || annualInterestBps <= 0) {
    return 1
  }
  return (1 + annualInterestBps / 10_000) ** (1 / FORTNIGHTS_PER_YEAR)
}

/**
 * The fortnightly contribution needed to take `startBalanceCents` to the goal's
 * target in `fortnightsLeft` whole fortnights. A met goal needs nothing; a
 * window already closed (`fortnightsLeft <= 0`) needs the full remaining amount
 * in one hit. With a modelled rate it is the closed-form growing annuity
 * `(target − balance₀·fⁿ)·(f − 1)/(fⁿ − 1)`, rounded up and floored at zero so
 * growth that already overshoots never asks for a negative contribution;
 * without a rate it is `ceil(remaining / fortnightsLeft)`.
 */
export function requiredContributionCents(
  goal: Pick<SavingsGoal, 'targetAmountCents' | 'annualInterestBps'>,
  startBalanceCents: Money,
  fortnightsLeft: number,
): Money {
  const remainingCents = Math.max(0, goal.targetAmountCents - startBalanceCents)
  if (remainingCents === 0) {
    return 0
  }
  if (fortnightsLeft <= 0) {
    return remainingCents
  }
  const f = fortnightGrowthFactor(goal.annualInterestBps)
  if (f > 1) {
    const growthOverTerm = f ** fortnightsLeft
    const annuity =
      ((goal.targetAmountCents - startBalanceCents * growthOverTerm) * (f - 1)) /
      (growthOverTerm - 1)
    return Math.max(0, Math.ceil(annuity))
  }
  return Math.ceil(remainingCents / fortnightsLeft)
}
