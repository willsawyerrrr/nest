import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface UseUpSyncResult {
  refreshing: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Triggers an on-demand Up sync, then reloads the passed queries so the UI
 * reflects what it pulled in — saver balances on the Goals tab, gift-category
 * transactions on the Gifts tab. The sync runs server-side in the JWT-verified
 * `up-sync` function, scoped to the caller's household. A failure is surfaced as
 * `error` rather than thrown, so stale data degrades gracefully.
 */
export function useUpSync(reload: () => Promise<void>): UseUpSyncResult {
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
      setError('Could not refresh from Up. Try again.')
    } finally {
      setRefreshing(false)
    }
  }, [reload])

  return { refreshing, error, refresh }
}
