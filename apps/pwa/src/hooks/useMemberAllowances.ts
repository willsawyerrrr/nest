import type { Tables } from '../lib/database.types'
import type { Frequency } from '../lib/domain'
import { useHouseholdCollection } from './useCollection'

export type MemberAllowance = Tables<'member_allowance'>

/** The editable allowance fields; the member and household an allowance belongs to are fixed. */
export interface MemberAllowanceInput {
  amount_cents: number
  frequency: Frequency
  /** Interval count for the `every_n_weeks`/`every_n_months` frequency; null for every fixed frequency. */
  interval_count: number | null
  /** Account that funds the allowance in the pay splits, or null when unrouted. */
  destination_account_id: string | null
}

export interface UseMemberAllowancesResult {
  allowances: MemberAllowance[] | null
  loading: boolean
  reload: () => Promise<void>
  update: (id: string, input: MemberAllowanceInput) => Promise<void>
}

/**
 * Loads and edits the household's member spending allowances. RLS scopes reads
 * to the household. Every member has exactly one allowance, created with the
 * member and never deleted, so there is no create or remove.
 */
export function useMemberAllowances(): UseMemberAllowancesResult {
  const { rows, loading, reload, update } = useHouseholdCollection<
    'member_allowance',
    MemberAllowanceInput
  >({ table: 'member_allowance', orderBy: 'created_at' })
  return { allowances: rows, loading, reload, update }
}
