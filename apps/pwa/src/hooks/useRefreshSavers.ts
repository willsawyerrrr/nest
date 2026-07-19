import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface UseRefreshSaversResult {
  refreshing: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Triggers an on-demand Up sync to refresh the household's synced saver
 * balances, then reloads the passed queries so the UI reflects the new
 * balances. The sync runs server-side in the JWT-verified `up-sync` function,
 * scoped to the caller's household. A failure is surfaced as `error` rather
 * than thrown, so a stale balance degrades gracefully.
 */
export function useRefreshSavers(reload: () => Promise<void>): UseRefreshSaversResult {
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const { error: invokeError } = await supabase.functions.invoke('up-sync', { body: {} })
      if (invokeError) {
        throw invokeError
      }
      await reload()
    } catch {
      setError('Could not refresh balances. Try again.')
    } finally {
      setRefreshing(false)
    }
  }, [reload])

  return { refreshing, error, refresh }
}
