import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/database.types'

export type TemporaryItem = Tables<'temporary_item'>

/** The temporary-item fields a form supplies; identifiers and household are set by the hook. */
export interface TemporaryItemInput {
  name: string
  contribution_cents: number
  target_date: string
}

export interface UseTemporaryItemsResult {
  items: TemporaryItem[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: TemporaryItemInput) => Promise<void>
  update: (id: string, input: TemporaryItemInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's temporary items. RLS scopes reads to the household. */
export function useTemporaryItems(householdId: string): UseTemporaryItemsResult {
  const [items, setItems] = useState<TemporaryItem[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('temporary_item').select('*').order('target_date')
    if (error) {
      throw error
    }
    setItems(data)
  }, [])

  const create = useCallback(
    async (input: TemporaryItemInput) => {
      const { error } = await supabase
        .from('temporary_item')
        .insert({ ...input, household_id: householdId })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  const update = useCallback(
    async (id: string, input: TemporaryItemInput) => {
      const { error } = await supabase.from('temporary_item').update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('temporary_item').delete().eq('id', id)
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
