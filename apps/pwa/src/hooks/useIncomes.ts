import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Enums, Tables } from '../lib/database.types'

export type Income = Tables<'income'>
export type IncomeType = Enums<'income_type'>
export type IncomeSchedule = Enums<'income_schedule'>

/** The income fields a form supplies; identifiers and household are set by the hook. */
export interface IncomeInput {
  name: string
  member_id: string
  type: IncomeType
  schedule: IncomeSchedule
  amount_cents: number | null
  hourly_rate_cents: number | null
  hours_per_period: number | null
}

export interface UseIncomesResult {
  incomes: Income[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: IncomeInput) => Promise<void>
  update: (id: string, input: IncomeInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's incomes. RLS scopes reads to the household. */
export function useIncomes(householdId: string): UseIncomesResult {
  const [incomes, setIncomes] = useState<Income[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('income').select('*').order('name')
    if (error) {
      throw error
    }
    setIncomes(data)
  }, [])

  const create = useCallback(
    async (input: IncomeInput) => {
      const { error } = await supabase
        .from('income')
        .insert({ ...input, household_id: householdId })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  const update = useCallback(
    async (id: string, input: IncomeInput) => {
      const { error } = await supabase.from('income').update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('income').delete().eq('id', id)
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

  return { incomes, loading: incomes === null, reload, create, update, remove }
}
