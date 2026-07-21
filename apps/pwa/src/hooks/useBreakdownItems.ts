import { useHouseholdCollection } from './useCollection'
import type { Tables } from '../lib/database.types'
import type { Frequency } from '../lib/domain'

export type BreakdownItem = Tables<'breakdown_item'>

/** The item fields a form supplies; identifiers, breakdown, and household are set by the hook. */
export interface BreakdownItemInput {
  name: string
  amount_cents: number
  frequency: Frequency
  /** Weeks between allocations for the `every_n_weeks` frequency; null for every other frequency. */
  interval_weeks: number | null
}

export interface UseBreakdownItemsResult {
  items: BreakdownItem[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: BreakdownItemInput) => Promise<void>
  update: (id: string, input: BreakdownItemInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates one breakdown's items. RLS scopes reads to the household. */
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
  })
  return { items: rows, loading, reload, create, update, remove }
}
