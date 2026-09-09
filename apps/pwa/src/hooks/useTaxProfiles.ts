import { financialYearForDate } from '@nest/tax'
import type { Enums, Tables } from '../lib/database.types'
import { useHouseholdUpsertCollection } from './useCollection'

export type TaxProfile = Tables<'tax_profile'>
export type TaxResidency = Enums<'tax_residency'>

/** The tax-profile fields a form supplies for a member in the current financial year. */
export interface TaxProfileInput {
  member_id: string
  residency: TaxResidency
  has_private_hospital_cover: boolean
}

/**
 * What one member's tax editor saves: their FY-scoped tax profile, and their date of
 * birth, which lives on the member rather than the year because a birthday is not a
 * financial-year fact.
 */
export interface TaxProfileSubmission {
  profile: TaxProfileInput
  dateOfBirth: string | null
}

export interface UseTaxProfilesResult {
  profiles: TaxProfile[] | null
  financialYear: number
  loading: boolean
  reload: () => Promise<void>
  upsert: (input: TaxProfileInput) => Promise<void>
}

/**
 * Loads and upserts tax profiles for `financialYear` (defaulting to the current
 * financial year), keyed by member. RLS scopes reads to the household.
 */
export function useTaxProfiles(
  financialYear: number = financialYearForDate(new Date()),
): UseTaxProfilesResult {
  const { rows, loading, reload, upsert } = useHouseholdUpsertCollection<
    'tax_profile',
    TaxProfileInput
  >({
    table: 'tax_profile',
    match: { financial_year: financialYear },
    insertDefaults: { financial_year: financialYear },
    onConflict: 'member_id,financial_year',
  })
  return { profiles: rows, financialYear, loading, reload, upsert }
}
