/**
 * Resolves a document-intake bearer token to the member and household it was
 * minted for. Used only by `document-intake`, which is `verify_jwt = false` —
 * the caller is a Shortcut carrying no Supabase session, so the token itself is
 * the whole of the credential.
 *
 * Hashes with the same scheme `create_document_intake_token` stores under
 * (`encode(sha256(convert_to(token, 'UTF8')), 'hex')`), mirroring
 * `_shared/shareGrant.ts`'s `hashShareToken` exactly. A missing or unmatched
 * token reports the identical generic 401 either way, so a guessed token learns
 * nothing from the response.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallerError } from './caller.ts'

export interface DocumentIntakeGrant {
  householdId: string
  memberId: string
}

interface DocumentIntakeTokenRow {
  household_id: string
  member_id: string
}

const GENERIC_INVALID_MESSAGE = 'This device is not connected. Reconnect it from the Household tab.'

/** sha256(token) as lowercase hex — the same digest `create_document_intake_token` stores `token_hash` as. */
export async function hashIntakeToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Resolves `token` to the {@link DocumentIntakeGrant} it grants, or a generic
 * 401. A blank token is rejected before ever hashing or querying. The lookup
 * runs on `admin` (a service-role client) because the token holder has no
 * `auth.uid()` for `document_intake_token`'s own RLS policy to match.
 */
export async function resolveDocumentIntakeToken(
  admin: SupabaseClient,
  token: string,
): Promise<{ grant: DocumentIntakeGrant } | { error: CallerError }> {
  const trimmed = token.trim()
  if (!trimmed) {
    return { error: { status: 401, message: GENERIC_INVALID_MESSAGE } }
  }

  const tokenHash = await hashIntakeToken(trimmed)
  const { data, error } = await admin
    .from('document_intake_token')
    .select('household_id, member_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) {
    return { error: { status: 500, message: 'Could not resolve this device.' } }
  }

  const row = data as DocumentIntakeTokenRow | null
  if (!row) {
    return { error: { status: 401, message: GENERIC_INVALID_MESSAGE } }
  }
  return { grant: { householdId: row.household_id, memberId: row.member_id } }
}
