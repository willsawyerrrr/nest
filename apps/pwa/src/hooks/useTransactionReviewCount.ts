import { useHouseholdId } from '../components/HouseholdProvider'
import { supabase } from '../lib/supabase'
import { useHouseholdQuery } from './useCollection'

/**
 * How many Up transactions await the signed-in member's review — the
 * unreviewed rows the review screen lists, RLS scoping them to
 * the member's balance-visible accounts — or null while loading or when
 * `enabled` is false, which reads nothing. Keyed under `transaction_review`,
 * so a saved review refreshes it.
 */
export function useTransactionReviewCount(enabled: boolean): number | null {
  const householdId = useHouseholdId()
  const query = useHouseholdQuery(
    ['transaction_review', householdId, 'count', enabled ? 'on' : 'off'],
    async () => {
      if (!enabled) {
        return null
      }
      const { count, error } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'up')
        .eq('is_categorizable', true)
        .is('reviewed_at', null)
      if (error) {
        throw error
      }
      return count ?? 0
    },
  )
  return query.data ?? null
}
