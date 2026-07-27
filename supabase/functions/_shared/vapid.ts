/**
 * Reads the Web Push VAPID credential set from Vault.
 *
 * The three secrets (`vapid_public_key`, `vapid_private_key`, `vapid_subject`)
 * are one credential, fetched together through the service-role-only
 * `vapid_keys()` RPC — the only read path. The operator sets and rotates them by
 * hand; see `docs/operations.md`.
 */

import { type SupabaseClient } from '@supabase/supabase-js'

export interface VapidKeys {
  /** The base64url-encoded raw P-256 public key (`0x04 || X || Y`). */
  publicKey: string
  /** The base64url-encoded raw P-256 private scalar. */
  privateKey: string
  /** The `mailto:` (or `https:`) contact URI the VAPID JWT's `sub` claim carries. */
  subject: string
}

/**
 * Shape the `vapid_keys()` row into a usable credential set, or `null` when it
 * is incomplete. Push is unavailable until all three secrets are set, and RFC
 * 8292 requires the subject be a `mailto:` or `https:` URI — a push service
 * rejects anything else with an opaque 400, so it is caught here instead.
 */
export function normaliseVapidKeys(row: unknown): VapidKeys | null {
  const fields = row as
    | { public_key?: unknown; private_key?: unknown; subject?: unknown }
    | null
    | undefined
  const publicKey = trimmed(fields?.public_key)
  const privateKey = trimmed(fields?.private_key)
  const subject = trimmed(fields?.subject)
  if (!publicKey || !privateKey || !subject) return null
  if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) return null
  return { publicKey, privateKey, subject }
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Fetch and normalise the credential set; `null` when unset or unreadable. */
export async function loadVapidKeys(admin: SupabaseClient): Promise<VapidKeys | null> {
  const { data, error } = await admin.rpc('vapid_keys')
  if (error) return null
  // `returns table (...)` surfaces as a one-row array through PostgREST.
  return normaliseVapidKeys(Array.isArray(data) ? data[0] : data)
}
