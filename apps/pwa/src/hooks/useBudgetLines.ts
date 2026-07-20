import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Enums, Tables } from '../lib/database.types'

export type BudgetLine = Tables<'budget_line'>
export type BudgetGroup = Enums<'budget_group'>
export type Frequency = Enums<'frequency'>
export type BudgetDerivedSource = Enums<'budget_derived_source'>

/** The budget-line fields a form supplies; identifiers and household are set by the hook. */
export interface BudgetLineInput {
  line_group: BudgetGroup
  name: string
  amount_cents: number
  frequency: Frequency
  /** Weeks between allocations for the `every_n_weeks` frequency; null for every other frequency. */
  interval_weeks: number | null
  goal_id: string | null
  /** The tracker a line's amount is derived from, or `null` for a manually entered amount. */
  derived_source: BudgetDerivedSource | null
  /** Account funding this line's pay split; only non-Savings/Investments lines may set it. */
  destination_account_id: string | null
}

export interface UseBudgetLinesResult {
  lines: BudgetLine[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: BudgetLineInput) => Promise<void>
  update: (id: string, input: BudgetLineInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's budget lines. RLS scopes reads to the household. */
export function useBudgetLines(householdId: string): UseBudgetLinesResult {
  const [lines, setLines] = useState<BudgetLine[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('budget_line').select('*').order('name')
    if (error) {
      throw error
    }
    setLines(data)
  }, [])

  const create = useCallback(
    async (input: BudgetLineInput) => {
      const { error } = await supabase
        .from('budget_line')
        .insert({ ...input, household_id: householdId })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  const update = useCallback(
    async (id: string, input: BudgetLineInput) => {
      const { error } = await supabase.from('budget_line').update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('budget_line').delete().eq('id', id)
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

  return { lines, loading: lines === null, reload, create, update, remove }
}
