import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface UsePayAccountResult {
  /** The account the household's pay lands in, or null when none is designated. */
  payAccountId: string | null
  loading: boolean
  reload: () => Promise<void>
  /** Designates (or, with null, clears) the household's pay account. */
  setPayAccount: (accountId: string | null) => Promise<void>
}

/**
 * Loads and sets the household's pay account — the single spending account pay
 * lands in, which the Splits tab treats as the source. Reads scope to the
 * household via RLS; the write goes through the `set_household_pay_account` RPC,
 * which validates the account and reloads so the Splits view reflects it live.
 */
export function usePayAccount(householdId: string): UsePayAccountResult {
  const [payAccountId, setPayAccountId] = useState<string | null | undefined>(undefined)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('households')
      .select('pay_account_id')
      .eq('id', householdId)
      .single()
    if (error) {
      throw error
    }
    setPayAccountId(data.pay_account_id)
  }, [householdId])

  const setPayAccount = useCallback(
    async (accountId: string | null) => {
      const { error } = await supabase.rpc('set_household_pay_account', {
        p_account_id: accountId,
      })
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
    payAccountId: payAccountId ?? null,
    loading: payAccountId === undefined,
    reload,
    setPayAccount,
  }
}
