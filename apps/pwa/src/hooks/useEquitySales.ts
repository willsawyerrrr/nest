import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type EquitySaleRow = Tables<'equity_sale'>

/** The sale fields a form supplies; the household is set by the hook. */
export interface EquitySaleInput {
  member_id: string
  grant_id: string
  sold_on: string
  quantity: number
  price_per_share_cents: number
  fee_cents: number
}

export interface UseEquitySalesResult {
  sales: EquitySaleRow[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: EquitySaleInput) => Promise<void>
  update: (id: string, input: EquitySaleInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's equity sales, oldest first. Every year loads:
 * a sale is matched against earlier exercises and its holding period runs from
 * its grant. RLS scopes reads to the household.
 */
export function useEquitySales(): UseEquitySalesResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'equity_sale',
    EquitySaleInput
  >({ table: 'equity_sale', orderBy: ['sold_on', 'created_at'] })
  return { sales: rows, loading, reload, create, update, remove }
}
