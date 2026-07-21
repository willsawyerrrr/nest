import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export type Member = Tables<'members'>

export interface UseMembersResult {
  members: Member[] | null
  loading: boolean
  reload: () => Promise<void>
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

  useEffect(() => {
    void reload()
  }, [reload])

  return { members, loading: members === null, reload }
}
