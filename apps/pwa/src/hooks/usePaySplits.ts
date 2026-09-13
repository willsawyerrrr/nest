import { useCallback } from 'react'
import { useHouseholdId } from '../components/HouseholdProvider'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdQuery } from './useCollection'

type PaySplit = Tables<'pay_split'>

export interface UsePaySplitsResult {
  /** The confirmed fortnightly split per account, keyed by account id. */
  configuredByAccount: Map<string, number>
  loading: boolean
  reload: () => Promise<void>
  /** Records the split the household has confirmed as set for an account. */
  confirm: (accountId: string, fortnightlyCents: number) => Promise<void>
  /**
   * Clears an account's confirmed split, reverting it to an unconfirmed
   * recommendation the household is prompted to set up again.
   */
  clear: (accountId: string) => Promise<void>
}

/**
 * Loads and confirms the household's per-account pay splits. RLS scopes reads to
 * the household. The confirmed amount is the source-agnostic "configured split"
 * the Splits tab compares against its recommendation to surface drift.
 */
export function usePaySplits(): UsePaySplitsResult {
  const householdId = useHouseholdId()

  const { data, loading, reload } = useHouseholdQuery(['pay_split', householdId], async () => {
    const { data, error } = await supabase.from('pay_split').select('*')
    if (error) {
      throw error
    }
    return data
  })

  const confirm = useCallback(
    async (accountId: string, fortnightlyCents: number) => {
      const { error } = await supabase.from('pay_split').upsert(
        {
          household_id: householdId,
          account_id: accountId,
          confirmed_fortnightly_cents: fortnightlyCents,
          confirmed_at: new Date().toISOString(),
        },
        { onConflict: 'household_id,account_id' },
      )
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  const clear = useCallback(
    async (accountId: string) => {
      const { error } = await supabase.from('pay_split').delete().eq('account_id', accountId)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const configuredByAccount = new Map<string, number>(
    (data ?? []).map((split: PaySplit) => [split.account_id, split.confirmed_fortnightly_cents]),
  )

  return { configuredByAccount, loading, reload, confirm, clear }
}
