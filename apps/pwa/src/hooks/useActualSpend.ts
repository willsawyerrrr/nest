import {
  actualSpendByGroup,
  type ActualSpend,
  type ActualSpendRow,
  type PayPeriod,
} from '@nest/plan'
import { useHouseholdId } from '../components/HouseholdProvider'
import { supabase } from '../lib/supabase'
import { useHouseholdQuery } from './useCollection'

/**
 * The signed-in member's spend per budget group over `period` (inclusive local
 * dates), from `budget_actual_spend`: settled spend only unless
 * `includePending`, over the accounts RLS lets them see. Null while loading.
 * Keyed under `budget_actual_spend`; a remapped category invalidates it.
 */
export function useActualSpend(period: PayPeriod, includePending: boolean): ActualSpend | null {
  const householdId = useHouseholdId()
  const query = useHouseholdQuery(
    [
      'budget_actual_spend',
      householdId,
      period.periodStart,
      period.periodEnd,
      includePending ? 'pending' : 'settled',
    ],
    async () => {
      const { data, error } = await supabase.rpc('budget_actual_spend', {
        p_start: period.periodStart,
        p_end: period.periodEnd,
        p_include_pending: includePending,
      })
      if (error) {
        throw error
      }
      // The generator types a set-returning function's columns non-null; a null
      // `line_group` is spend in no group.
      return actualSpendByGroup(data as ActualSpendRow[])
    },
  )
  return query.data ?? null
}
