import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'

type PaySplit = Tables<'pay_split'>

export interface UsePaySplitsResult {
  /** The confirmed fortnightly split per account, keyed by account id. */
  configuredByAccount: Map<string, number>
  loading: boolean
  reload: () => Promise<void>
  /** Records the split the household has confirmed as set in Up for an account. */
  confirm: (accountId: string, fortnightlyCents: number) => Promise<void>
}

/**
 * Loads and confirms the household's per-account pay splits. RLS scopes reads to
 * the household. The confirmed amount is the source-agnostic "configured split"
 * the Splits tab compares against its recommendation to surface drift.
 */
export function usePaySplits(householdId: string): UsePaySplitsResult {
  const [splits, setSplits] = useState<PaySplit[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('pay_split').select('*')
    if (error) {
      throw error
    }
    setSplits(data)
  }, [])

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

  useEffect(() => {
    void reload()
  }, [reload])

  const configuredByAccount = new Map(
    (splits ?? []).map((split) => [split.account_id, split.confirmed_fortnightly_cents]),
  )

  return { configuredByAccount, loading: splits === null, reload, confirm }
}
