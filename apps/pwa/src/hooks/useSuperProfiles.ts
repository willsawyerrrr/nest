import { useCallback, useEffect, useState } from 'react'
import { financialYearForDate } from '@nest/tax'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/database.types'

export type SuperProfile = Tables<'super_profile'>

/** The super-profile fields a form supplies for a member in the current financial year. */
export interface SuperProfileInput {
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
  const [profiles, setProfiles] = useState<SuperProfile[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('super_profile')
      .select('*')
      .eq('financial_year', financialYear)
    if (error) {
      throw error
    }
    setProfiles(data)
  }, [financialYear])

  const upsert = useCallback(
    async (input: SuperProfileInput) => {
      const { error } = await supabase
        .from('super_profile')
        .upsert(
          { ...input, household_id: householdId, financial_year: financialYear },
          { onConflict: 'member_id,financial_year' },
        )
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, financialYear, reload],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return { profiles, financialYear, loading: profiles === null, reload, upsert }
}
