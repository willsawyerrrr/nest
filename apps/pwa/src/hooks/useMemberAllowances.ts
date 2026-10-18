import { useMemo } from 'react'
import { useHouseholdId } from '../components/HouseholdProvider'
import type { Tables } from '../lib/database.types'
import type { Frequency } from '../lib/domain'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection, useHouseholdQuery } from './useCollection'

/**
 * A member's allowance row. For a co-member's allowance, whose drawn lines are
 * private to them, it also carries the total drawn from it; for the signed-in
 * member's own allowance the lines themselves are read.
 */
export type MemberAllowance = Tables<'member_allowance'> & {
  drawn_fortnightly_cents?: number
  drawn_annual_cents?: number
}

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
 * member and never deleted, so there is no create or remove. A co-member's
 * allowance carries its drawn total from `hidden_allowance_drawn`, since the
 * lines drawn from it are readable only by that member.
 */
export function useMemberAllowances(): UseMemberAllowancesResult {
  const householdId = useHouseholdId()
  const { rows, loading, reload, update } = useHouseholdCollection<
    'member_allowance',
    MemberAllowanceInput
  >({ table: 'member_allowance', orderBy: 'created_at' })
  const hidden = useHouseholdQuery(['hidden_allowance_drawn', householdId], async () => {
    const { data, error } = await supabase.rpc('hidden_allowance_drawn')
    if (error) {
      throw error
    }
    return data
  })
  const allowances = useMemo(() => {
    if (!rows) {
      return null
    }
    const drawn = new Map((hidden.data ?? []).map((total) => [total.member_id, total]))
    return rows.map((row): MemberAllowance => {
      const total = drawn.get(row.member_id)
      return total
        ? {
            ...row,
            drawn_fortnightly_cents: total.drawn_fortnightly_cents,
            drawn_annual_cents: total.drawn_annual_cents,
          }
        : row
    })
  }, [rows, hidden.data])
  return {
    allowances,
    loading: loading || hidden.loading,
    reload: async () => {
      await Promise.all([reload(), hidden.reload()])
    },
    update,
  }
}
