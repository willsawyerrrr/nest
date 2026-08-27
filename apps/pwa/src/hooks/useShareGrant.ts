import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'

/**
 * The columns `authenticated` may read (see the migration's column-level
 * grant) — never `token_hash`, the credential itself, and never
 * `created_by_member_id`. `select('*')` would fail outright: Postgres refuses
 * a `SELECT *` when the caller lacks privilege on any expanded column.
 */
export type ShareGrantRow = Pick<
  Tables<'share_grant'>,
  'household_id' | 'financial_year' | 'recipient_email' | 'expires_at' | 'created_at'
>

/** What `share-create` returns: the plaintext token, shown once, and whether it emailed. */
export interface CreatedShare {
  token: string
  expiresAt: string
  emailSent: boolean
}

export interface UseShareGrantResult {
  /** The household's single live share, or null when none is active. */
  status: ShareGrantRow | null
  loading: boolean
  reload: () => Promise<void>
  /** Mints (or replaces) the household's share via `share-create`. */
  create: (financialYear: number, recipientEmail: string) => Promise<CreatedShare>
  /** Revokes the household's live share; a no-op when there is none. */
  revoke: () => Promise<void>
}

/**
 * Loads and manages the household's single live EOFY share. Bespoke rather
 * than `useHouseholdCollection`: `share_grant` is keyed on `household_id`
 * itself (at most one row per household), not an `id` column, and every write
 * goes through `share-create` / `revoke_share_grant` rather than a plain
 * insert/update/delete.
 */
export function useShareGrant(): UseShareGrantResult {
  const [status, setStatus] = useState<ShareGrantRow | null | undefined>(undefined)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('share_grant')
      .select('household_id, financial_year, recipient_email, expires_at, created_at')
      .maybeSingle()
    if (error) {
      throw error
    }
    setStatus(data)
  }, [])

  const create = useCallback(
    async (financialYear: number, recipientEmail: string) => {
      const { data, error } = await supabase.functions.invoke<CreatedShare>('share-create', {
        body: { financialYear, recipientEmail },
      })
      if (error) {
        throw error
      }
      await reload()
      return data as CreatedShare
    },
    [reload],
  )

  const revoke = useCallback(async () => {
    const { error } = await supabase.rpc('revoke_share_grant')
    if (error) {
      throw error
    }
    await reload()
  }, [reload])

  useEffect(() => {
    void reload()
  }, [reload])

  return { status: status ?? null, loading: status === undefined, reload, create, revoke }
}
