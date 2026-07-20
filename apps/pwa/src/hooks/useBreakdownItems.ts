import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/database.types'
import type { Frequency } from './useBudgetLines'

export type BreakdownItem = Tables<'breakdown_item'>

/** The item fields a form supplies; identifiers, breakdown, and household are set by the hook. */
export interface BreakdownItemInput {
  name: string
  amount_cents: number
  frequency: Frequency
  /** Weeks between allocations for the `every_n_weeks` frequency; null for every other frequency. */
  interval_weeks: number | null
}

export interface UseBreakdownItemsResult {
  items: BreakdownItem[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: BreakdownItemInput) => Promise<void>
  update: (id: string, input: BreakdownItemInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates one breakdown's items. RLS scopes reads to the household. */
export function useBreakdownItems(
  householdId: string,
  breakdownId: string,
): UseBreakdownItemsResult {
  const [items, setItems] = useState<BreakdownItem[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('breakdown_item')
      .select('*')
      .eq('breakdown_id', breakdownId)
      .order('name')
    if (error) {
      throw error
    }
    setItems(data)
  }, [breakdownId])

  const create = useCallback(
    async (input: BreakdownItemInput) => {
      const { error } = await supabase
        .from('breakdown_item')
        .insert({ ...input, breakdown_id: breakdownId, household_id: householdId })
      if (error) {
        throw error
      }
      await reload()
    },
    [breakdownId, householdId, reload],
  )

  const update = useCallback(
    async (id: string, input: BreakdownItemInput) => {
      const { error } = await supabase.from('breakdown_item').update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('breakdown_item').delete().eq('id', id)
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

  return { items, loading: items === null, reload, create, update, remove }
}
