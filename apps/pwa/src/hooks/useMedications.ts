import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/database.types'
import type { Frequency } from './useBudgetLines'

export type Medication = Tables<'medication'>

/** The medication fields a form supplies; the household is set by the hook. */
export interface MedicationInput {
  name: string
  /** Informational dose label, or null when unset. */
  dose: string | null
  amount_cents: number
  frequency: Frequency
  /** Weeks between costs for the `every_n_weeks` frequency; null for every other frequency. */
  interval_weeks: number | null
}

export interface UseMedicationsResult {
  medications: Medication[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: MedicationInput) => Promise<void>
  update: (id: string, input: MedicationInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's medications. RLS scopes reads to the household. */
export function useMedications(householdId: string): UseMedicationsResult {
  const [medications, setMedications] = useState<Medication[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('medication').select('*').order('name')
    if (error) {
      throw error
    }
    setMedications(data)
  }, [])

  const create = useCallback(
    async (input: MedicationInput) => {
      const { error } = await supabase
        .from('medication')
        .insert({ ...input, household_id: householdId })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  const update = useCallback(
    async (id: string, input: MedicationInput) => {
      const { error } = await supabase.from('medication').update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('medication').delete().eq('id', id)
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

  return { medications, loading: medications === null, reload, create, update, remove }
}
