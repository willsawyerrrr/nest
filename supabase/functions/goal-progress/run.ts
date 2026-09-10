/**
 * The `goal-progress` flow with its I/O injected, so the shape — resolve the
 * caller's household, load its savings goals, resolve each balance — is
 * unit-tested without a database. `index.ts` wires the real service-role reads.
 *
 * It answers "how are my savings goals going": each goal's saved and target
 * amount and the household totals, computed the same way the PWA Goals screen
 * derives a goal's effective balance (a linked Up saver's synced balance where
 * the goal links one, else the manually entered figure).
 */

import type { CallerError } from '../_shared/caller.ts'

/** The `savings_goal` columns this reads. */
export interface GoalRow {
  name: string
  target_amount_cents: number
  current_balance_cents: number
  target_date: string | null
  linked_account_id: string | null
}

/** A synced Up saver: the id a goal links to and its balance. */
export interface SaverBalanceRow {
  id: string
  balance_cents: number
}

/** One goal's progress in the response. */
export interface GoalProgress {
  name: string
  savedCents: number
  targetCents: number
}

/** The `goal-progress` response body. */
export interface GoalProgressBody {
  /** Every goal, dated ones first by date then name, undated after by name. */
  goals: GoalProgress[]
  totalSavedCents: number
  totalTargetCents: number
}

/**
 * Shapes the household's goals into the response: a goal's saved amount is its
 * linked saver's synced balance when `linked_account_id` resolves to one, else
 * its own `current_balance_cents`. Dated goals sort ahead of undated ones (a
 * date is a commitment), each block by name within it, so the first entry is the
 * one a spoken summary should lead with.
 */
export function shapeGoalProgress(
  goals: readonly GoalRow[],
  savers: readonly SaverBalanceRow[],
): GoalProgressBody {
  const balanceById = new Map(savers.map((saver) => [saver.id, saver.balance_cents]))

  const shaped = goals
    .map((goal) => ({
      name: goal.name,
      savedCents: goal.linked_account_id != null && balanceById.has(goal.linked_account_id)
        ? balanceById.get(goal.linked_account_id)!
        : goal.current_balance_cents,
      targetCents: goal.target_amount_cents,
      targetDate: goal.target_date,
    }))
    .sort((a, b) => {
      if (a.targetDate != null && b.targetDate != null) {
        return a.targetDate.localeCompare(b.targetDate) || a.name.localeCompare(b.name)
      }
      if (a.targetDate != null) return -1
      if (b.targetDate != null) return 1
      return a.name.localeCompare(b.name)
    })

  return {
    goals: shaped.map(({ name, savedCents, targetCents }) => ({ name, savedCents, targetCents })),
    totalSavedCents: shaped.reduce((total, goal) => total + goal.savedCents, 0),
    totalTargetCents: shaped.reduce((total, goal) => total + goal.targetCents, 0),
  }
}

export interface GoalProgressDeps {
  /** Resolves the caller's household from their JWT, or the error to return. */
  resolveHousehold: () => Promise<{ householdId: string } | { error: CallerError }>
  /** Loads the household's savings goals and its synced Up savers. */
  loadGoalsAndSavers: (
    householdId: string,
  ) => Promise<{ goals: readonly GoalRow[]; savers: readonly SaverBalanceRow[] }>
}

export interface GoalProgressResult {
  status: number
  body: unknown
}

export async function runGoalProgress(deps: GoalProgressDeps): Promise<GoalProgressResult> {
  const resolved = await deps.resolveHousehold()
  if ('error' in resolved) {
    return { status: resolved.error.status, body: { error: resolved.error.message } }
  }
  const { goals, savers } = await deps.loadGoalsAndSavers(resolved.householdId)
  return { status: 200, body: shapeGoalProgress(goals, savers) }
}
