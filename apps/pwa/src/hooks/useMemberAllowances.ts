import type { Tables } from '../lib/database.types'
import type { Frequency } from '../lib/domain'
import { useHouseholdCollection } from './useCollection'

export type MemberAllowance = Tables<'member_allowance'>

/** The allowance fields a form supplies; identifiers and household are set by the hook. */
export interface MemberAllowanceInput {
  member_id: string
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
  create: (input: MemberAllowanceInput) => Promise<void>
  update: (id: string, input: MemberAllowanceInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's member spending allowances. RLS scopes reads
 * to the household. Removing an allowance releases the budget lines drawn from
 * it, so those are refetched too.
 */
export function useMemberAllowances(): UseMemberAllowancesResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'member_allowance',
    MemberAllowanceInput
  >({ table: 'member_allowance', orderBy: 'created_at', alsoInvalidate: ['budget_line'] })
  return { allowances: rows, loading, reload, create, update, remove }
}
