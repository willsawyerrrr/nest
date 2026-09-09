import type { EquityInstrumentType, VestingFrequency } from '@nest/plan'
import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type EquityGrantRow = Tables<'equity_grant'>

/**
 * The equity-grant fields a form supplies; the household is set by the hook. A
 * member may hold many grants, so grants are created, updated, and removed
 * individually rather than upserted by member.
 */
export interface EquityGrantInput {
  member_id: string
  label: string
  instrument_type: EquityInstrumentType
  quantity: number
  grant_date: string
  cliff_months: number
  vesting_period_months: number
  vesting_frequency: VestingFrequency
  strike_price_cents: number | null
  price_per_share_cents: number
  price_as_of: string | null
}

export interface UseEquityGrantsResult {
  grants: EquityGrantRow[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: EquityGrantInput) => Promise<void>
  update: (id: string, input: EquityGrantInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's equity grants, ordered by grant date. RLS
 * scopes reads to the household.
 */
export function useEquityGrants(): UseEquityGrantsResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'equity_grant',
    EquityGrantInput
  >({ table: 'equity_grant', orderBy: 'grant_date' })
  return { grants: rows, loading, reload, create, update, remove }
}
