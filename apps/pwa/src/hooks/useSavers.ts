import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Account } from './useAccounts'

export type Saver = Account

export interface UseSaversResult {
  savers: Saver[] | null
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Loads the household's synced Up saver accounts (`source = 'up'`, `type =
 * 'savings'`). RLS scopes reads to the household. Used to populate the goal
 * saver picker and to resolve a linked goal's balance from `balance_cents`.
 */
export function useSavers(): UseSaversResult {
  const [savers, setSavers] = useState<Saver[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('accounts_with_balance')
      .select('*')
      .eq('source', 'up')
      .eq('type', 'savings')
      .order('name')
    if (error) {
      throw error
    }
    // The view never returns a null in these columns; see `Account` in domain.ts.
    setSavers(data as Saver[])
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { savers, loading: savers === null, reload }
}
