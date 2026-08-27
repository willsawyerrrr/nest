/**
 * Resolves an EOFY share bearer token to the household and financial year it
 * grants read access to. Shared by `eofy-share` and `eofy-share-file`, both
 * `verify_jwt = false` — the caller carries no Supabase session, so the token
 * itself is the whole of the credential.
 *
 * Hashes with the same scheme `create_share_grant` stores under
 * (`encode(sha256(convert_to(token, 'UTF8')), 'hex')`), so the plaintext token
 * that only ever reaches the household is never itself at rest. A missing,
 * malformed, expired, or revoked token all report the identical generic 401 —
 * never distinguishing "expired" from "never existed" — so a forwarded or
 * guessed token learns nothing from the response either way.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallerError } from './caller.ts'

export interface ShareGrant {
  householdId: string
  financialYear: number
}

interface ShareGrantRow {
  household_id: string
  financial_year: number
  expires_at: string
}

const GENERIC_INVALID_MESSAGE = 'This share link is invalid or has expired.'

/**
 * sha256(token) as lowercase hex — the same digest `create_share_grant` stores
 * `token_hash` as, so a lookup by hash matches exactly what the household's RPC
 * minted.
 */
export async function hashShareToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Decides the outcome for a row already looked up by token hash: a live grant,
 * or the generic 401 whether the row is absent (no match, or revoked — deleted
 * outright rather than flagged) or its `expires_at` has passed.
 */
export function evaluateShareGrantRow(
  row: ShareGrantRow | null,
  now: Date = new Date(),
): { grant: ShareGrant } | { error: CallerError } {
  if (!row || new Date(row.expires_at).getTime() <= now.getTime()) {
    return { error: { status: 401, message: GENERIC_INVALID_MESSAGE } }
  }
  return { grant: { householdId: row.household_id, financialYear: row.financial_year } }
}

/**
 * Resolves `token` to the {@link ShareGrant} it grants, or a generic 401. A
 * blank token is rejected before ever hashing or querying. The lookup runs on
 * `admin` (a service-role client) because the token holder has no `auth.uid()`
 * for `share_grant`'s own RLS policy to match.
 */
export async function resolveShareGrant(
  admin: SupabaseClient,
  token: string,
): Promise<{ grant: ShareGrant } | { error: CallerError }> {
  const trimmed = token.trim()
  if (!trimmed) {
    return { error: { status: 401, message: GENERIC_INVALID_MESSAGE } }
  }

  const tokenHash = await hashShareToken(trimmed)
  const { data, error } = await admin
    .from('share_grant')
    .select('household_id, financial_year, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) {
    return { error: { status: 500, message: 'Could not resolve the share link.' } }
  }

  return evaluateShareGrantRow(data as ShareGrantRow | null)
}
