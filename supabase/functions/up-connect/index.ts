/**
 * Connect a member's Up personal access token. JWT-verified: the caller is
 * resolved to their own member from the Authorization JWT (never the body), so a
 * member can only connect their own token.
 *
 * Takes `{ token }`, validates it against Up (`UpClient.ping()`), and on success
 * stores it encrypted in Supabase Vault via the service-role-only
 * `store_up_token` RPC. The token is never returned to the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { UpClient } from '../_shared/up.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveCaller } from '../_shared/caller.ts'
import { runConnect } from './connect.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: { token?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Captured from member resolution so storeToken can reuse the service client.
  let admin: SupabaseClient | null = null

  const result = await runConnect(body.token, {
    validateToken: (token) => new UpClient(token).ping(),
    resolveMember: async () => {
      const resolved = await resolveCaller(request)
      if ('error' in resolved) {
        return { error: resolved.error }
      }
      admin = resolved.caller.admin
      return { memberId: resolved.caller.memberId }
    },
    storeToken: async (memberId, token) => {
      const { error } = await admin!.rpc('store_up_token', {
        p_member_id: memberId,
        p_token: token,
      })
      return !error
    },
  })

  return json(result.body, result.status)
})
