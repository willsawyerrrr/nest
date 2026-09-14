import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useHouseholdId } from '../components/HouseholdProvider'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdQuery } from './useCollection'

export type RedbarkConnection = Tables<'redbark_connection'>

/** Where a completed (or abandoned) Redbark Link Session round-trip landed. */
export type RedbarkCompleteResult =
  { status: 'connected' } | { status: 'pending' } | { status: 'failed'; reason: string | null }

/**
 * The `sessionStorage` key a pending Link Session id is stashed under across the
 * full-page redirect to Redbark's hosted consent flow and back. `sessionStorage`
 * (not in-memory state) is required: the redirect unloads the page.
 */
const LINK_SESSION_STORAGE_KEY = 'redbark-link-session-id'

export interface UseRedbarkConnectionsResult {
  /** The household's Redbark connections, newest first. */
  connections: RedbarkConnection[] | null
  loading: boolean
  busy: boolean
  reload: () => Promise<void>
  /**
   * Starts a new connection: calls `redbark-connect`, stashes the returned link
   * session id in `sessionStorage`, then navigates the browser to Redbark's
   * hosted consent page. Never resolves on success — the navigation away is the
   * result.
   */
  connect: (returnUrl: string) => Promise<void>
  /** Disconnects a household member's bank connection. */
  disconnect: (connectionId: string) => Promise<void>
  /**
   * The outcome of completing a link session id found in `sessionStorage` on
   * mount, or null when there was none pending. Set once per mount; call
   * {@link dismissCompleteResult} once it has been shown.
   */
  completeResult: RedbarkCompleteResult | null
  dismissCompleteResult: () => void
}

/**
 * Loads the household's Redbark bank connections and drives the connect/
 * disconnect flow. Connecting is a full-page redirect to a Redbark-hosted CDR
 * consent screen rather than a token paste, so it round-trips through
 * `sessionStorage` rather than component state: `connect` stashes the pending
 * link session id before navigating away, and on mount this hook checks for
 * one left behind by a completed (or abandoned) round-trip, resolves it via
 * `redbark-connect-complete`, and clears the stashed id regardless of outcome.
 * A `connected: true` result also triggers `redbark-sync` so newly linked
 * accounts appear without waiting for the next scheduled sync, and refreshes
 * the connections list alongside the `accounts_with_balance` /
 * `account_directory` caches {@link useSavers} and the account views read.
 */
export function useRedbarkConnections(): UseRedbarkConnectionsResult {
  const householdId = useHouseholdId()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [completeResult, setCompleteResult] = useState<RedbarkCompleteResult | null>(null)
  // Guards the mount-time completion check against React StrictMode's double
  // effect invocation, which would otherwise resolve the same link session
  // twice before the first call clears it from `sessionStorage`.
  const completionChecked = useRef(false)

  const { data, loading, reload } = useHouseholdQuery(
    ['redbark_connection', householdId],
    async () => {
      const { data, error } = await supabase
        .from('redbark_connection')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) {
        throw error
      }
      return data
    },
  )

  const refreshAccounts = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['accounts_with_balance', householdId] }),
      queryClient.invalidateQueries({ queryKey: ['account_directory', householdId] }),
    ])
  }, [queryClient, householdId])

  useEffect(() => {
    // Only reachable via StrictMode's real double-invoke-effects behaviour,
    // which jsdom/vitest's effect scheduling does not reproduce even under
    // `<StrictMode>` — verified empirically, not just untested.
    /* v8 ignore next 3 */
    if (completionChecked.current) {
      return
    }
    const linkSessionId = sessionStorage.getItem(LINK_SESSION_STORAGE_KEY)
    if (!linkSessionId) {
      return
    }
    completionChecked.current = true

    void (async () => {
      setBusy(true)
      try {
        const { data, error } = await supabase.functions.invoke('redbark-connect-complete', {
          body: { linkSessionId },
        })
        if (error) {
          setCompleteResult({ status: 'failed', reason: error.message })
          return
        }
        if (data.connected) {
          setCompleteResult({ status: 'connected' })
          await supabase.functions.invoke('redbark-sync', { body: {} })
          await Promise.all([reload(), refreshAccounts()])
        } else {
          setCompleteResult(
            data.status === 'failed'
              ? { status: 'failed', reason: data.reason ?? null }
              : { status: 'pending' },
          )
        }
      } finally {
        sessionStorage.removeItem(LINK_SESSION_STORAGE_KEY)
        setBusy(false)
      }
    })()
    // Runs once on mount to resolve a pending round-trip left in `sessionStorage`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connect = useCallback(async (returnUrl: string) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('redbark-connect', {
        body: { returnUrl },
      })
      if (error) {
        throw error
      }
      sessionStorage.setItem(LINK_SESSION_STORAGE_KEY, data.linkSessionId)
      window.location.href = data.url
    } catch (error) {
      setBusy(false)
      throw error
    }
  }, [])

  const disconnect = useCallback(
    async (connectionId: string) => {
      setBusy(true)
      try {
        const { error } = await supabase.functions.invoke('redbark-disconnect', {
          body: { connectionId },
        })
        if (error) {
          throw error
        }
        await Promise.all([reload(), refreshAccounts()])
      } finally {
        setBusy(false)
      }
    },
    [reload, refreshAccounts],
  )

  const dismissCompleteResult = useCallback(() => setCompleteResult(null), [])

  return {
    connections: data ?? null,
    loading,
    busy,
    reload,
    connect,
    disconnect,
    completeResult,
    dismissCompleteResult,
  }
}
