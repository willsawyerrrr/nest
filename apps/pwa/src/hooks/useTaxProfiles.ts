import { financialYearForDate } from '@nest/tax'
import { useHouseholdUpsertCollection } from './useCollection'
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
  const { rows, loading, reload, upsert } = useHouseholdUpsertCollection<
    'tax_profile',
    TaxProfileInput
  >(householdId, {
    table: 'tax_profile',
    match: { financial_year: financialYear },
    insertDefaults: { financial_year: financialYear },
    onConflict: 'member_id,financial_year',
  })
  return { profiles: rows, financialYear, loading, reload, upsert }
}
