import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Enums, Tables } from '../lib/database.types'
import type { BudgetGroup } from './useBudgetLines'
import type { BreakdownItem } from './useBreakdownItems'

export type Breakdown = Tables<'breakdown'>
export type BreakdownKind = Enums<'breakdown_kind'>

/** The fields creating a breakdown supplies; identifiers and household are set by the hook. */
export interface BreakdownInput {
  name: string
  line_group: BudgetGroup
  kind: BreakdownKind
}

/** The mutable fields of a breakdown: its rolled-up line's name and group. */
export interface BreakdownUpdate {
  name: string
  line_group: BudgetGroup
}

export interface UseBreakdownsResult {
  breakdowns: Breakdown[] | null
  /** Every generic breakdown item across the household, for roll-up totals and lifecycle counts. */
  items: BreakdownItem[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: BreakdownInput) => Promise<void>
  update: (id: string, input: BreakdownUpdate) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's breakdowns, alongside every generic
 * breakdown item so a caller can roll up each breakdown's total and count its
 * items. RLS scopes reads to the household; deletes cascade to items in the
 * database.
 */
export function useBreakdowns(householdId: string): UseBreakdownsResult {
  const [breakdowns, setBreakdowns] = useState<Breakdown[] | null>(null)
  const [items, setItems] = useState<BreakdownItem[] | null>(null)

  const reload = useCallback(async () => {
    const [breakdownRes, itemRes] = await Promise.all([
      supabase.from('breakdown').select('*').order('name'),
      supabase.from('breakdown_item').select('*').order('name'),
    ])
    for (const res of [breakdownRes, itemRes]) {
      if (res.error) {
        throw res.error
      }
    }
    setBreakdowns(breakdownRes.data)
    setItems(itemRes.data)
  }, [])

  const create = useCallback(
    async (input: BreakdownInput) => {
      const { error } = await supabase
        .from('breakdown')
        .insert({ ...input, household_id: householdId })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  const update = useCallback(
    async (id: string, input: BreakdownUpdate) => {
      const { error } = await supabase.from('breakdown').update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('breakdown').delete().eq('id', id)
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
    breakdowns,
    items,
    loading: breakdowns === null || items === null,
    reload,
    create,
    update,
    remove,
  }
}
