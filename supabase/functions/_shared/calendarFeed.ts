/**
 * Resolves a calendar-feed bearer token to the household it grants read access
 * to. Used by `calendar-ics`, which runs `verify_jwt = false` — a calendar
 * client subscribing to the feed URL carries no Supabase session, so the token
 * in the URL is the whole of the credential.
 *
 * Hashes with the same scheme `create_calendar_feed_token` stores under
 * (`encode(sha256(convert_to(token, 'UTF8')), 'hex')`), so the plaintext token
 * that only ever reaches the household is never itself at rest. A blank or
 * unknown token resolves to null, which `calendar-ics` turns into the same bare
 * 404 a bad path gives — so a guessed or stale token learns nothing from it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * sha256(token) as lowercase hex — the same digest `create_calendar_feed_token`
 * stores `token_hash` as, so a lookup by hash matches exactly what the
 * household's RPC minted.
 */
export async function hashCalendarToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Resolves `token` to the household its feed belongs to, or null when the token
 * is blank or matches no row. The lookup runs on `admin` (a service-role client)
 * because the token holder has no `auth.uid()` for `calendar_feed`'s own RLS
 * policy to match. A database error throws, surfacing as a 500 in `index.ts`.
 */
export async function resolveCalendarFeed(
  admin: SupabaseClient,
  token: string,
): Promise<{ householdId: string } | null> {
  const trimmed = token.trim()
  if (!trimmed) {
    return null
  }

  const tokenHash = await hashCalendarToken(trimmed)
  const { data, error } = await admin
    .from('calendar_feed')
    .select('household_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) {
    throw new Error(`Failed to resolve calendar feed: ${error.message}`)
  }
  if (!data) {
    return null
  }

  return { householdId: (data as { household_id: string }).household_id }
}
