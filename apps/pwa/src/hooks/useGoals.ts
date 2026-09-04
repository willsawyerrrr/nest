import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type Goal = Tables<'savings_goal'>

/** The savings-goal fields a form supplies; identifiers and household are set by the hook. */
export interface GoalInput {
  name: string
  target_amount_cents: number
  target_date: string | null
  current_balance_cents: number
  linked_account_id: string | null
  /** Modelled effective annual interest rate in basis points; null models no interest. */
  annual_interest_bps: number | null
  /** Order among the household's queued goals; null sorts last. Set by the drag-reorder. */
  queue_position: number | null
  /** Cap on the fortnightly amount a queued goal draws from freed capacity; null draws the whole pool. */
  planned_contribution_cents: number | null
}

export interface UseGoalsResult {
  goals: Goal[] | null
  /** The goals before any planning-mode overrides — the real baseline for comparison. */
  baselineGoals: Goal[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: GoalInput) => Promise<void>
  update: (id: string, input: GoalInput) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Rewrites the queued goals' positions to `orderedIds`, writing only the goals that moved. */
  reorderQueue: (orderedIds: readonly string[]) => Promise<void>
}

/** A goal row as a complete {@link GoalInput}, with `patch` fields overridden. */
export function goalInputFromRow(goal: Goal, patch: Partial<GoalInput> = {}): GoalInput {
  return {
    name: goal.name,
    target_amount_cents: goal.target_amount_cents,
    target_date: goal.target_date,
    current_balance_cents: goal.current_balance_cents,
    linked_account_id: goal.linked_account_id,
    annual_interest_bps: goal.annual_interest_bps,
    queue_position: goal.queue_position,
    planned_contribution_cents: goal.planned_contribution_cents,
    ...patch,
  }
}

/** Loads and mutates the household's savings goals. RLS scopes reads to the household. */
export function useGoals(householdId: string): UseGoalsResult {
  const { rows, baselineRows, loading, reload, create, update, remove } = useHouseholdCollection<
    'savings_goal',
    GoalInput
  >(householdId, { table: 'savings_goal', orderBy: ['queue_position', 'name'] })

  const reorderQueue = async (orderedIds: readonly string[]): Promise<void> => {
    const byId = new Map((rows ?? []).map((goal) => [goal.id, goal]))
    await Promise.all(
      orderedIds.map((id, position) => {
        const goal = byId.get(id)
        if (!goal || goal.queue_position === position) {
          return undefined
        }
        return update(id, goalInputFromRow(goal, { queue_position: position }))
      }),
    )
  }

  return {
    goals: rows,
    baselineGoals: baselineRows,
    loading,
    reload,
    create,
    update,
    remove,
    reorderQueue,
  }
}
