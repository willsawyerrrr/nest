import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { setChangelogUpdateAvailable } from './useChangelogUpdateAvailable'

export interface ImplementedEntry {
  type: string
  scope: string | null
  description: string
  date: string
  sha: string
}

export interface InProgressEntry {
  type: string
  scope: string | null
  description: string
  number: number
  url: string
}

export interface UseChangelogResult {
  available: ImplementedEntry[]
  implemented: ImplementedEntry[]
  inProgress: InProgressEntry[]
  configured: boolean
  loading: boolean
  error: string | null
}

interface ChangelogResponse {
  configured: boolean
  available: ImplementedEntry[]
  implemented: ImplementedEntry[]
  inProgress: InProgressEntry[]
}

const LOAD_ERROR_MESSAGE = "Could not load what's new. Try again later."

/**
 * Loads the "What's new" changelog from the JWT-verified `changelog` edge
 * function, which proxies GitHub server-side. The read is repo-wide, not
 * household-scoped, so it is a plain session query keyed on the build's commit
 * SHA. A failure is surfaced as `error` rather than thrown, so the screen
 * degrades gracefully; when the function has no GitHub token it replies
 * `configured: false` with empty lists.
 */
export function useChangelog(): UseChangelogResult {
  // The build's commit SHA lets the function drop any merged-commit entry newer
  // than the running build; an empty SHA (local/dev) fails open server-side.
  const sha = import.meta.env.VITE_COMMIT_SHA

  const query = useQuery({
    queryKey: ['changelog', sha],
    queryFn: async () => {
      const body = sha ? { sha } : {}
      const { data, error } = await supabase.functions.invoke<ChangelogResponse>('changelog', {
        body,
      })
      if (error || !data) {
        throw new Error(LOAD_ERROR_MESSAGE)
      }
      const available = data.available ?? []
      setChangelogUpdateAvailable(available.length > 0)
      return {
        configured: data.configured,
        available,
        implemented: data.implemented,
        inProgress: data.inProgress,
      }
    },
  })

  const { data } = query
  return {
    available: data ? data.available : [],
    implemented: data ? data.implemented : [],
    inProgress: data ? data.inProgress : [],
    configured: data ? data.configured : true,
    loading: query.isPending,
    error: query.isError ? LOAD_ERROR_MESSAGE : null,
  }
}
