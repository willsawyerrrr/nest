import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/database.types'

export type Goal = Tables<'savings_goal'>

/** The savings-goal fields a form supplies; identifiers and household are set by the hook. */
export interface GoalInput {
  name: string
  target_amount_cents: number
  target_date: string | null
  current_balance_cents: number
  linked_account_id: string | null
}

export interface UseGoalsResult {
  goals: Goal[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: GoalInput) => Promise<void>
  update: (id: string, input: GoalInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's savings goals. RLS scopes reads to the household. */
export function useGoals(householdId: string): UseGoalsResult {
  const [goals, setGoals] = useState<Goal[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('savings_goal').select('*').order('name')
    if (error) {
      throw error
    }
    setGoals(data)
  }, [])

  const create = useCallback(
    async (input: GoalInput) => {
      const { error } = await supabase
        .from('savings_goal')
        .insert({ ...input, household_id: householdId })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  const update = useCallback(
    async (id: string, input: GoalInput) => {
      const { error } = await supabase.from('savings_goal').update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('savings_goal').delete().eq('id', id)
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

  return { goals, loading: goals === null, reload, create, update, remove }
}
