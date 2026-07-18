import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/database.types'

export type Household = Tables<'households'>

export interface UseHouseholdResult {
  households: Household[] | null
  loading: boolean
  reload: () => Promise<void>
}

/** Loads the households the signed-in user belongs to. RLS scopes the result. */
export function useHousehold(): UseHouseholdResult {
  const [households, setHouseholds] = useState<Household[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('households').select('*')
    if (error) {
      throw error
    }
    setHouseholds(data)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { households, loading: households === null, reload }
}
