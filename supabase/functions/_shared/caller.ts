/**
 * Resolves the caller of a JWT-verified edge function to their own member row.
 *
 * The member is derived from the Authorization JWT — never from the request
 * body — so a caller can only ever act on their own data. Returns a
 * service-role client (for trusted Vault RPCs and reads that must bypass RLS)
 * alongside a client scoped to the caller's own JWT (for an RPC that must run
 * as them, so `auth.uid()` resolves) and the member id, or a
 * `{ status, message }` error when the caller cannot be resolved.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface ResolvedCaller {
  admin: SupabaseClient
  /** The caller's own JWT-scoped client — RLS applies, so `auth.uid()` resolves as them. */
  asUser: SupabaseClient
  memberId: string
}

export interface CallerError {
  status: number
  message: string
}

export async function resolveCaller(
  request: Request,
): Promise<{ caller: ResolvedCaller } | { error: CallerError }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return { error: { status: 500, message: 'Server credentials not configured' } }
  }

  const authHeader = request.headers.get('Authorization')
  if (!authHeader) {
    return { error: { status: 401, message: 'Missing authorization' } }
  }

  // Resolve the authenticated user from their JWT.
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData.user) {
    return { error: { status: 401, message: 'Invalid authorization' } }
  }

  // Look up their own member row with the service role.
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: member, error: memberError } = await admin
    .from('members')
    .select('id')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (memberError) {
    return { error: { status: 500, message: 'Could not resolve member' } }
  }
  if (!member) {
    return { error: { status: 404, message: 'No household membership for this user' } }
  }

  return { caller: { admin, asUser, memberId: member.id as string } }
}

/**
 * A lazily-resolved caller paired with the service-role client the resolution
 * captures, shaped for the connect/disconnect flows.
 */
export interface MemberResolution {
  /**
   * The `resolveMember` dependency for `runConnect` / `runDisconnect`: resolves
   * the caller from the request JWT and captures the service-role client for the
   * later Vault RPC. Called lazily so the connect flow can validate the token
   * before any member is resolved.
   */
  resolveMember: () => Promise<{ memberId?: string; error?: CallerError }>
  /** The service-role client captured by a successful `resolveMember`. */
  admin: () => SupabaseClient
}

/**
 * Bundles the member-resolution closure and the service-role client it captures,
 * so the connect and disconnect functions share one resolution path instead of
 * each hand-rolling the capture. `resolveCaller` is injectable for testing.
 */
export function resolveMemberWithAdmin(
  request: Request,
  resolve: typeof resolveCaller = resolveCaller,
): MemberResolution {
  let admin: SupabaseClient | null = null
  return {
    resolveMember: async () => {
      const resolved = await resolve(request)
      if ('error' in resolved) {
        return { error: resolved.error }
      }
      admin = resolved.caller.admin
      return { memberId: resolved.caller.memberId }
    },
    admin: () => admin!,
  }
}
