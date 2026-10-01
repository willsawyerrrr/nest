import { useCallback } from 'react'
import { useHouseholdId } from '../components/HouseholdProvider'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdQuery } from './useCollection'

export type Member = Tables<'members'>

export interface UseMembersResult {
  members: Member[] | null
  loading: boolean
  reload: () => Promise<void>
  /**
   * Records any household member's date of birth, or clears it when passed null. It
   * is the one member field the app edits for a co-member, and it exists for a single reading: the member's age
   * at a one-off termination payment's date, which sets the rate its concessional
   * part is taxed at.
   */
  setDateOfBirth: (memberId: string, dateOfBirth: string | null) => Promise<void>
}

/** Loads the household's members. RLS scopes the result to the household. */
export function useMembers(): UseMembersResult {
  const householdId = useHouseholdId()

  const { data, loading, reload } = useHouseholdQuery(['members', householdId], async () => {
    const { data, error } = await supabase.from('members').select('*').order('name')
    if (error) {
      throw error
    }
    return data
  })

  const setDateOfBirth = useCallback(
    async (memberId: string, dateOfBirth: string | null) => {
      const { error } = await supabase.rpc('set_member_date_of_birth', {
        p_member_id: memberId,
        p_date_of_birth: dateOfBirth as string,
      })
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  return { members: data ?? null, loading, reload, setDateOfBirth }
}
