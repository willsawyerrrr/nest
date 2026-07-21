import { useHouseholdCollection } from './useCollection'
import type { Tables } from '../lib/database.types'
import type { BudgetGroup, Frequency } from '../lib/domain'

export type BudgetLine = Tables<'budget_line'>

/** The budget-line fields a form supplies; identifiers and household are set by the hook. */
export interface BudgetLineInput {
  line_group: BudgetGroup
  name: string
  amount_cents: number
  frequency: Frequency
  /** Weeks between allocations for the `every_n_weeks` frequency; null for every other frequency. */
  interval_weeks: number | null
  goal_id: string | null
  /** The breakdown that owns this line (its amount, name, and group), or `null` for a manual line. */
  breakdown_id: string | null
  /** Account funding this line's pay split; only non-Savings/Investments lines may set it. */
  destination_account_id: string | null
}

export interface UseBudgetLinesResult {
  lines: BudgetLine[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: BudgetLineInput) => Promise<void>
  update: (id: string, input: BudgetLineInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's budget lines. RLS scopes reads to the household. */
export function useBudgetLines(householdId: string): UseBudgetLinesResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'budget_line',
    BudgetLineInput
  >(householdId, { table: 'budget_line', orderBy: 'name' })
  return { lines: rows, loading, reload, create, update, remove }
}
