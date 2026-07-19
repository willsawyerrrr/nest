/**
 * Resolves the caller of a JWT-verified edge function to their own member row.
 *
 * The member is derived from the Authorization JWT — never from the request
 * body — so a caller can only ever act on their own Up connection. Returns a
 * service-role client (for the trusted Vault RPCs) alongside the member id, or a
 * `{ status, message }` error when the caller cannot be resolved.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface ResolvedCaller {
  admin: SupabaseClient
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

  return { caller: { admin, memberId: member.id as string } }
}
