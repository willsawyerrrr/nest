import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** A verified Supabase access token and a client that acts as its member. */
export interface VerifiedToken {
  userId: string
  /** The anon-key client carrying the member's token, so row-level security applies. */
  supabase: SupabaseClient
}

export interface AuthConfig {
  supabaseUrl: string
  anonKey: string
}

/** The bearer token of an `Authorization` header, if it carries one. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer +(\S+)$/i.exec(header ?? '')
  return match?.[1] ?? null
}

/**
 * Verifies `token` as an access token issued by this project's Supabase Auth
 * (signature against the project's JWKS, expiry, and issuer) and returns a
 * per-request client acting as its member with the anon key. Returns `null`
 * for any token that does not verify.
 */
export async function verifyToken(
  config: AuthConfig,
  token: string,
): Promise<VerifiedToken | null> {
  const supabase = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  try {
    const { data, error } = await supabase.auth.getClaims(token)
    const claims = data?.claims
    if (error || !claims?.sub || claims.role !== 'authenticated') return null
    if (claims.iss !== `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1`) return null
    return { userId: claims.sub, supabase }
  } catch {
    return null
  }
}
