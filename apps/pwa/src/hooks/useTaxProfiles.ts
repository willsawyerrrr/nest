import { useCallback, useEffect, useState } from 'react'
import { financialYearForDate } from '@nest/tax'
import { supabase } from '../lib/supabase'
import type { Enums, Tables } from '../lib/database.types'

export type TaxProfile = Tables<'tax_profile'>
export type TaxResidency = Enums<'tax_residency'>

/** The tax-profile fields a form supplies for a member in the current financial year. */
export interface TaxProfileInput {
  member_id: string
  residency: TaxResidency
  has_private_hospital_cover: boolean
  help_debt_cents: number
}

export interface UseTaxProfilesResult {
  profiles: TaxProfile[] | null
  financialYear: number
  loading: boolean
  reload: () => Promise<void>
  upsert: (input: TaxProfileInput) => Promise<void>
}

/**
 * Loads and upserts tax profiles for the household's current financial year,
 * keyed by member. RLS scopes reads to the household.
 */
export function useTaxProfiles(householdId: string): UseTaxProfilesResult {
  const financialYear = financialYearForDate(new Date())
  const [profiles, setProfiles] = useState<TaxProfile[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('tax_profile')
      .select('*')
      .eq('financial_year', financialYear)
    if (error) {
      throw error
    }
    setProfiles(data)
  }, [financialYear])

  const upsert = useCallback(
    async (input: TaxProfileInput) => {
      const { error } = await supabase
        .from('tax_profile')
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
