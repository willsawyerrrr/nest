import { useCallback, useEffect, useState } from 'react'
import { financialYearForDate } from '@nest/tax'
import { supabase } from '../lib/supabase'
import type { Enums, Tables } from '../lib/database.types'
import type { Frequency } from './useInflows'

export type { Frequency }

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
  const [contributions, setContributions] = useState<SuperContribution[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('super_contribution')
      .select('*')
      .eq('financial_year', financialYear)
    if (error) {
      throw error
    }
    setContributions(data)
  }, [financialYear])

  const create = useCallback(
    async (input: SuperContributionInput) => {
      const { error } = await supabase
        .from('super_contribution')
        .insert({ ...input, household_id: householdId, financial_year: financialYear })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, financialYear, reload],
  )

  const update = useCallback(
    async (id: string, input: SuperContributionInput) => {
      const { error } = await supabase.from('super_contribution').update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('super_contribution').delete().eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    contributions,
    financialYear,
    loading: contributions === null,
    reload,
    create,
    update,
    remove,
  }
}
