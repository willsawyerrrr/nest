import { financialYearForDate } from '@nest/tax'
import type { Tables } from '../lib/database.types'
import { useHouseholdUpsertCollection } from './useCollection'

export type SuperProfile = Tables<'super_profile'>

/** The super-profile fields a form supplies for a member in the current financial year. */
interface SuperProfileInput {
  member_id: string
  fund_name: string | null
  linked_account_id: string | null
  /** The date the linked account's balance was last confirmed (a true-up); null means never. */
  balance_as_of: string | null
}

export interface UseSuperProfilesResult {
  profiles: SuperProfile[] | null
  financialYear: number
  loading: boolean
  reload: () => Promise<void>
  upsert: (input: SuperProfileInput) => Promise<void>
}

/**
 * Loads and upserts super profiles for `financialYear` (defaulting to the
 * current financial year), keyed by member. RLS scopes reads to the household.
 * The balance itself lives on the linked account, not here.
 */
export function useSuperProfiles(
  financialYear: number = financialYearForDate(new Date()),
): UseSuperProfilesResult {
  const { rows, loading, reload, upsert } = useHouseholdUpsertCollection<
    'super_profile',
    SuperProfileInput
  >({
    table: 'super_profile',
    match: { financial_year: financialYear },
    insertDefaults: { financial_year: financialYear },
    onConflict: 'member_id,financial_year',
  })
  return { profiles: rows, financialYear, loading, reload, upsert }
}
