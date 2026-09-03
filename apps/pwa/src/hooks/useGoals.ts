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
}

/** Loads and mutates the household's savings goals. RLS scopes reads to the household. */
export function useGoals(householdId: string): UseGoalsResult {
  const { rows, baselineRows, loading, reload, create, update, remove } = useHouseholdCollection<
    'savings_goal',
    GoalInput
  >(householdId, { table: 'savings_goal', orderBy: 'name' })
  return { goals: rows, baselineGoals: baselineRows, loading, reload, create, update, remove }
}
