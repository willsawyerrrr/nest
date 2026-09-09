import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useMembers, type Member } from './useMembers'

export interface UseCurrentMemberResult {
  member: Member | null
  loading: boolean
}

/**
 * Resolves the signed-in user's household member by matching a member's
 * `user_id` to the authenticated session user. `member` is null while loading
 * and for a user with no matching member row. The session user is a session-
 * scoped query, cached apart from the household data.
 */
export function useCurrentMember(): UseCurrentMemberResult {
  const { members, loading: membersLoading } = useMembers()
  const { data: userId, isPending: userLoading } = useQuery({
    queryKey: ['auth', 'user'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser()
      return data.user?.id ?? null
    },
  })

  const loading = membersLoading || userLoading
  const member = members?.find((candidate) => candidate.user_id === userId) ?? null
  return { member, loading }
}
