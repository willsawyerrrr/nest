import { useCallback, useState } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection } from './useCollection'

/** Whether a household member currently has a live document-intake token, and since when — never the token itself. */
export type DocumentIntakeTokenStatus = Pick<
  Tables<'document_intake_token'>,
  'member_id' | 'created_at'
>

/** A freshly minted token: shown once, then gone — the app never stores it. */
export interface MintedDocumentIntakeToken {
  token: string
  createdAt: string
}

export interface UseDocumentIntakeTokensResult {
  /** Every household member's token status, so a co-member's "active since" shows even though only they can mint or revoke it. */
  statuses: DocumentIntakeTokenStatus[]
  loading: boolean
  busy: boolean
  /** Mints (or replaces) the signed-in member's own token. Returned once — the app never persists it. */
  create: () => Promise<MintedDocumentIntakeToken>
  /** Revokes the signed-in member's own token, if any. */
  revoke: () => Promise<void>
}

/**
 * Document-intake token status for every household member, and the mint/revoke
 * actions for the signed-in member's own. `create_document_intake_token` /
 * `revoke_document_intake_token` are both SECURITY DEFINER RPCs that resolve
 * the caller's own member from their JWT — there is no `member_id` parameter,
 * exactly as `up-connect`/`up-disconnect` operate on the caller's own member —
 * so a member can only ever act on their own device connection, though every
 * member's status is visible household-wide.
 */
export function useDocumentIntakeTokens(householdId: string): UseDocumentIntakeTokensResult {
  const { rows, loading, reload } = useHouseholdCollection<'document_intake_token', never>(
    householdId,
    { table: 'document_intake_token' },
  )
  const [busy, setBusy] = useState(false)

  const create = useCallback(async (): Promise<MintedDocumentIntakeToken> => {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('create_document_intake_token')
      if (error) {
        throw error
      }
      // `returns table (...)` surfaces as a one-row array through PostgREST.
      const row = (Array.isArray(data) ? data[0] : data) as { token: string; created_at: string }
      await reload()
      return { token: row.token, createdAt: row.created_at }
    } finally {
      setBusy(false)
    }
  }, [reload])

  const revoke = useCallback(async () => {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('revoke_document_intake_token')
      if (error) {
        throw error
      }
      await reload()
    } finally {
      setBusy(false)
    }
  }, [reload])

  return { statuses: rows ?? [], loading, busy, create, revoke }
}
