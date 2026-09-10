import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

/**
 * Loads the households the signed-in user belongs to. RLS scopes the result.
 * This hook renders above `HouseholdProvider` — it is where the household id
 * comes from — so it cannot key on the household. It keys instead on the authed
 * user id, resolved through the same `['auth', 'user']` query `useCurrentMember`
 * shares, so a sign-in as a different user reads a fresh list.
 */
export function useHousehold(): UseHouseholdResult {
  const queryClient = useQueryClient()

  const { data: userId, isPending: userLoading } = useQuery({
    queryKey: ['auth', 'user'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser()
      return data.user?.id ?? null
    },
  })

  const query = useQuery({
    queryKey: ['households', userId ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.from('households').select('*')
      if (error) {
        throw error
      }
      return data
    },
    enabled: !userLoading,
  })

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['households'] })
  }, [queryClient])

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

  return {
    households: query.data ?? null,
    loading: userLoading || query.isPending,
    reload,
    createHousehold,
    joinHousehold,
    createInviteCode,
    revokeInviteCode,
  }
}
