import type { Tables } from '../lib/database.types'
import type { BudgetGroup, Frequency } from '../lib/domain'
import { useHouseholdCollection } from './useCollection'

export type BudgetLine = Tables<'budget_line'>

/** The budget-line fields a form supplies; identifiers and household are set by the hook. */
export interface BudgetLineInput {
  line_group: BudgetGroup
  name: string
  amount_cents: number
  frequency: Frequency
  /** Interval count for the `every_n_weeks`/`every_n_months` frequency (weeks or months, read from `frequency`); null for every fixed frequency. */
  interval_count: number | null
  goal_id: string | null
  /** The generic breakdown that owns this line (its amount, name, and group), or `null` for a gift or manual line. */
  breakdown_id: string | null
  /** Account funding this line's pay split; only non-Savings/Investments lines may set it. */
  destination_account_id: string | null
  /** On a gift line, the member whose gifts it funds; null for the external gift line, generic lines, and manual lines. */
  gift_recipient_member_id: string | null
  /** True for a gift-derived line — the per-member and external gift lines — identifying it independently of `breakdown_id`. */
  is_gift_line: boolean
}

export interface UseBudgetLinesResult {
  lines: BudgetLine[] | null
  /** The budget lines before any planning-mode overrides — the real baseline for comparison. */
  baselineLines: BudgetLine[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: BudgetLineInput) => Promise<void>
  update: (id: string, input: BudgetLineInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's budget lines. RLS scopes reads to the household. */
export function useBudgetLines(): UseBudgetLinesResult {
  const { rows, baselineRows, loading, reload, create, update, remove } = useHouseholdCollection<
    'budget_line',
    BudgetLineInput
  >({ table: 'budget_line', orderBy: 'name' })
  return { lines: rows, baselineLines: baselineRows, loading, reload, create, update, remove }
}
