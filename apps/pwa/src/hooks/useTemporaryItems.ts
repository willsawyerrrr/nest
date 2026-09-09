import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type TemporaryItem = Tables<'temporary_item'>

/** The temporary-item fields a form supplies; identifiers and household are set by the hook. */
export interface TemporaryItemInput {
  name: string
  contribution_cents: number
  target_date: string
}

export interface UseTemporaryItemsResult {
  items: TemporaryItem[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: TemporaryItemInput) => Promise<void>
  update: (id: string, input: TemporaryItemInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's temporary items. RLS scopes reads to the household. */
export function useTemporaryItems(): UseTemporaryItemsResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'temporary_item',
    TemporaryItemInput
  >({ table: 'temporary_item', orderBy: 'target_date' })
  return { items: rows, loading, reload, create, update, remove }
}
