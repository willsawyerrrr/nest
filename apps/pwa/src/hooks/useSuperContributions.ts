import { financialYearForDate } from '@nest/tax'
import { useHouseholdCollection } from './useCollection'
import type { Enums, Tables } from '../lib/database.types'
import type { Frequency } from '../lib/domain'

export type SuperContribution = Tables<'super_contribution'>
export type SuperContributionKind = Enums<'super_contribution_kind'>
export type SuperContributionMode = Enums<'super_contribution_mode'>

/**
 * The super-contribution fields a form supplies for a member; the household and
 * financial year are set by the hook. Exactly one of `amount_cents` (when `mode`
 * is `amount`) or `percent_bp` (when `mode` is `percent`) is set.
 */
export interface SuperContributionInput {
  member_id: string
  kind: SuperContributionKind
  mode: SuperContributionMode
  amount_cents: number | null
  percent_bp: number | null
  frequency: Frequency
  interval_weeks: number | null
  fhss_eligible: boolean
  contributor_member_id: string | null
}

export interface UseSuperContributionsResult {
  contributions: SuperContribution[] | null
  financialYear: number
  loading: boolean
  reload: () => Promise<void>
  create: (input: SuperContributionInput) => Promise<void>
  update: (id: string, input: SuperContributionInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's super contributions for the current
 * financial year. RLS scopes reads to the household.
 */
export function useSuperContributions(householdId: string): UseSuperContributionsResult {
  const financialYear = financialYearForDate(new Date())
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'super_contribution',
    SuperContributionInput
  >(householdId, {
    table: 'super_contribution',
    match: { financial_year: financialYear },
    insertDefaults: { financial_year: financialYear },
  })
  return { contributions: rows, financialYear, loading, reload, create, update, remove }
}
