import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface UseUpConnectionResult {
  busy: boolean
  connect: (token: string) => Promise<void>
  disconnect: () => Promise<void>
}

/**
 * Connect or disconnect the signed-in member's Up personal access token. Both
 * actions call a JWT-verified edge function; the token is sent to `up-connect`
 * and never stored client-side. On success the members list is refreshed so the
 * connection status (`members.up_connected_at`) reflects the change.
 */
export function useUpConnection(reloadMembers: () => Promise<void>): UseUpConnectionResult {
  const [busy, setBusy] = useState(false)

  const connect = useCallback(
    async (token: string) => {
      setBusy(true)
      try {
        const { error } = await supabase.functions.invoke('up-connect', { body: { token } })
        if (error) {
          throw error
        }
        await reloadMembers()
      } finally {
        setBusy(false)
      }
    },
    [reloadMembers],
  )

  const disconnect = useCallback(async () => {
    setBusy(true)
    try {
      const { error } = await supabase.functions.invoke('up-disconnect', { body: {} })
      if (error) {
        throw error
      }
      await reloadMembers()
    } finally {
      setBusy(false)
    }
  }, [reloadMembers])

  return { busy, connect, disconnect }
}
