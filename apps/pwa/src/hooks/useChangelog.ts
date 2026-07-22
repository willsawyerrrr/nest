import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
  implemented: ImplementedEntry[]
  inProgress: InProgressEntry[]
  configured: boolean
  loading: boolean
  error: string | null
}

interface ChangelogResponse {
  configured: boolean
  implemented: ImplementedEntry[]
  inProgress: InProgressEntry[]
}

/**
 * Loads the "What's new" changelog from the JWT-verified `changelog` edge
 * function, which proxies GitHub server-side. A failure is surfaced as `error`
 * rather than thrown, so the screen degrades gracefully; when the function has
 * no GitHub token it replies `configured: false` with empty lists.
 */
export function useChangelog(): UseChangelogResult {
  const [implemented, setImplemented] = useState<ImplementedEntry[]>([])
  const [inProgress, setInProgress] = useState<InProgressEntry[]>([])
  const [configured, setConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    // Pass the build's commit SHA so the function drops any merged-commit entry
    // newer than the running build; an empty SHA (local/dev) fails open server-side.
    const sha = import.meta.env.VITE_COMMIT_SHA
    const body = sha ? { sha } : {}
    supabase.functions
      .invoke<ChangelogResponse>('changelog', { body })
      .then(({ data, error: invokeError }) => {
        if (!active) {
          return
        }
        if (invokeError || !data) {
          setError("Could not load what's new. Try again later.")
          return
        }
        setConfigured(data.configured)
        setImplemented(data.implemented)
        setInProgress(data.inProgress)
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  return { implemented, inProgress, configured, loading, error }
}
