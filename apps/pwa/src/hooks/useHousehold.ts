import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export type Household = Tables<'households'>

export interface UseHouseholdResult {
  households: Household[] | null
  loading: boolean
  reload: () => Promise<void>
  createHousehold: (name: string, memberName: string) => Promise<void>
  joinHousehold: (code: string, memberName: string) => Promise<void>
  createInviteCode: () => Promise<void>
  revokeInviteCode: () => Promise<void>
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

  const createHousehold = useCallback(
    async (name: string, memberName: string) => {
      const { error } = await supabase.rpc('create_household', {
        p_name: name,
        p_member_name: memberName,
      })
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const joinHousehold = useCallback(
    async (code: string, memberName: string) => {
      const { error } = await supabase.rpc('join_household', {
        p_code: code,
        p_member_name: memberName,
      })
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const createInviteCode = useCallback(async () => {
    const { error } = await supabase.rpc('create_invite_code')
    if (error) {
      throw error
    }
    await reload()
  }, [reload])

  const revokeInviteCode = useCallback(async () => {
    const { error } = await supabase.rpc('revoke_invite_code')
    if (error) {
      throw error
    }
    await reload()
  }, [reload])

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    households,
    loading: households === null,
    reload,
    createHousehold,
    joinHousehold,
    createInviteCode,
    revokeInviteCode,
  }
}
