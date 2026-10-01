import type { Enums, Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type TradeRow = Tables<'trade'>

/**
 * The trade fields a form supplies; the household is set by the hook, and a
 * hand-entered trade takes the database defaults for `source` and `external_id`.
 */
export interface TradeInput {
  member_id: string
  ticker: string
  side: Enums<'trade_side'>
  traded_on: string
  units: number
  price_per_unit_cents: number
  fee_cents: number
}

export interface UseTradesResult {
  trades: TradeRow[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: TradeInput) => Promise<void>
  update: (id: string, input: TradeInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's share and ETF trades, oldest first. Every
 * year is loaded: a sale is matched against purchases from earlier years, so no
 * financial-year filter applies. RLS scopes reads to the household.
 */
export function useTrades(): UseTradesResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'trade',
    TradeInput
  >({ table: 'trade', orderBy: ['traded_on', 'created_at'] })
  return { trades: rows, loading, reload, create, update, remove }
}
