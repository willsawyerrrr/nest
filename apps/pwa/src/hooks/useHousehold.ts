import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
  const queryClient = useQueryClient()

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('households').select('*')
    if (error) {
      throw error
    }
    setHouseholds(data)
  }, [])

  // Seeding or adding a member drives the `budget_line` reconcile trigger — it
  // rewrites the household's derived "Gifts for <member>" lines and their
  // buyer-account funding — so the new household's budget_line cache is
  // invalidated once the RPC returns its household id.
  const invalidateBudgetLines = useCallback(
    async (householdId: string) => {
      await queryClient.invalidateQueries({ queryKey: ['budget_line', householdId] })
    },
    [queryClient],
  )

  const createHousehold = useCallback(
    async (name: string, memberName: string) => {
      const { data, error } = await supabase.rpc('create_household', {
        p_name: name,
        p_member_name: memberName,
      })
      if (error) {
        throw error
      }
      await invalidateBudgetLines(data)
      await reload()
    },
    [invalidateBudgetLines, reload],
  )

  const joinHousehold = useCallback(
    async (code: string, memberName: string) => {
      const { data, error } = await supabase.rpc('join_household', {
        p_code: code,
        p_member_name: memberName,
      })
      if (error) {
        throw error
      }
      await invalidateBudgetLines(data)
      await reload()
    },
    [invalidateBudgetLines, reload],
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
