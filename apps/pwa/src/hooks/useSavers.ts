import { useHouseholdId } from '../components/HouseholdProvider'
import { supabase } from '../lib/supabase'
import type { Account } from './useAccounts'
import { useHouseholdQuery } from './useCollection'

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
 * Shares the `accounts_with_balance` cache prefix with {@link useAccounts}, so a
 * balance write there refetches this slice.
 */
export function useSavers(): UseSaversResult {
  const householdId = useHouseholdId()

  const { data, loading, reload } = useHouseholdQuery(
    ['accounts_with_balance', householdId, 'savers'],
    async () => {
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
      return data as Saver[]
    },
  )

  return { savers: data ?? null, loading, reload }
}
