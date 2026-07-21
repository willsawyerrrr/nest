import { financialYearForDate } from '@nest/tax'
import { useHouseholdUpsertCollection } from './useCollection'
import type { Tables } from '../lib/database.types'

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
 * Loads and upserts super profiles for the household's current financial year,
 * keyed by member. RLS scopes reads to the household. The balance itself lives
 * on the linked account, not here.
 */
export function useSuperProfiles(householdId: string): UseSuperProfilesResult {
  const financialYear = financialYearForDate(new Date())
  const { rows, loading, reload, upsert } = useHouseholdUpsertCollection<
    'super_profile',
    SuperProfileInput
  >(householdId, {
    table: 'super_profile',
    match: { financial_year: financialYear },
    insertDefaults: { financial_year: financialYear },
    onConflict: 'member_id,financial_year',
  })
  return { profiles: rows, financialYear, loading, reload, upsert }
}
