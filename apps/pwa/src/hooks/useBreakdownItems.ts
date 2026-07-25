import type { Tables } from '../lib/database.types'
import type { Frequency } from '../lib/domain'
import { useHouseholdCollection } from './useCollection'

export type BreakdownItem = Tables<'breakdown_item'>

/** The item fields a form supplies; identifiers, breakdown, and household are set by the hook. */
export interface BreakdownItemInput {
  name: string
  amount_cents: number
  frequency: Frequency
  /** Interval count for the `every_n_weeks`/`every_n_months` frequency (weeks or months, read from `frequency`); null for every fixed frequency. */
  interval_count: number | null
}

export interface UseBreakdownItemsResult {
  items: BreakdownItem[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: BreakdownItemInput) => Promise<void>
  update: (id: string, input: BreakdownItemInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates one breakdown's items. RLS scopes reads to the household.
 * An item write drives the `budget_line` reconcile trigger, which rewrites the
 * breakdown's derived line, so the mutation invalidates `budget_line` too and
 * consumers reading the raw lines (the Pay splits tab) refetch the new amount.
 */
export function useBreakdownItems(
  householdId: string,
  breakdownId: string,
): UseBreakdownItemsResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'breakdown_item',
    BreakdownItemInput
  >(householdId, {
    table: 'breakdown_item',
    orderBy: 'name',
    match: { breakdown_id: breakdownId },
    insertDefaults: { breakdown_id: breakdownId },
    alsoInvalidate: ['budget_line'],
  })
  return { items: rows, loading, reload, create, update, remove }
}
