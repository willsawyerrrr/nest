import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export type Member = Tables<'members'>

export interface UseMembersResult {
  members: Member[] | null
  loading: boolean
  reload: () => Promise<void>
  /**
   * Records a member's date of birth, or clears it when passed null. It is the one
   * member field the app edits, and it exists for a single reading: the member's age
   * at a one-off termination payment's date, which sets the rate its concessional
   * part is taxed at.
   */
  setDateOfBirth: (memberId: string, dateOfBirth: string | null) => Promise<void>
}

/** Loads the household's members. RLS scopes the result to the household. */
export function useMembers(): UseMembersResult {
  const [members, setMembers] = useState<Member[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('members').select('*').order('name')
    if (error) {
      throw error
    }
    setMembers(data)
  }, [])

  const setDateOfBirth = useCallback(
    async (memberId: string, dateOfBirth: string | null) => {
      const { error } = await supabase
        .from('members')
        .update({ date_of_birth: dateOfBirth })
        .eq('id', memberId)
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

  return { members, loading: members === null, reload, setDateOfBirth }
}
