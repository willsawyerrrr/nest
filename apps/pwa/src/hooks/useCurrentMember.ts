import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMembers, type Member } from './useMembers'

export interface UseCurrentMemberResult {
  member: Member | null
  loading: boolean
}

/**
 * Resolves the signed-in user's household member by matching a member's
 * `user_id` to the authenticated session user. `member` is null while loading
 * and for a user with no matching member row.
 */
export function useCurrentMember(): UseCurrentMemberResult {
  const { members, loading: membersLoading } = useMembers()
  const [userId, setUserId] = useState<string | null>(null)
  const [userLoading, setUserLoading] = useState(true)

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null)
      setUserLoading(false)
    })
  }, [])

  const loading = membersLoading || userLoading
  const member = members?.find((candidate) => candidate.user_id === userId) ?? null
  return { member, loading }
}
