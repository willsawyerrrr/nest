import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Enums, Tables } from '../lib/database.types'

export type Inflow = Tables<'inflows'>
export type InflowType = Enums<'inflow_type'>
export type Frequency = Enums<'frequency'>

/** The inflow fields a form supplies; identifiers and household are set by the hook. */
export interface InflowInput {
  name: string
  taxable: boolean
  member_id: string | null
  type: InflowType
  schedule: Frequency
  amount_cents: number | null
  hourly_rate_cents: number | null
  hours_per_period: number | null
}

export interface UseInflowsResult {
  inflows: Inflow[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: InflowInput) => Promise<void>
  update: (id: string, input: InflowInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's inflows. RLS scopes reads to the household. */
export function useInflows(householdId: string): UseInflowsResult {
  const [inflows, setInflows] = useState<Inflow[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('inflows').select('*').order('name')
    if (error) {
      throw error
    }
    setInflows(data)
  }, [])

  const create = useCallback(
    async (input: InflowInput) => {
      const { error } = await supabase
        .from('inflows')
        .insert({ ...input, household_id: householdId })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  const update = useCallback(
    async (id: string, input: InflowInput) => {
      const { error } = await supabase.from('inflows').update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('inflows').delete().eq('id', id)
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

  return { inflows, loading: inflows === null, reload, create, update, remove }
}
