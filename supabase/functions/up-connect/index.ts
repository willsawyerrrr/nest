/**
 * Connect a member's Up personal access token. JWT-verified: the caller is
 * resolved to their own member from the Authorization JWT (never the body), so a
 * member can only connect their own token.
 *
 * Takes `{ token }`, validates it against Up (`UpClient.ping()`), and on success
 * stores it encrypted in Supabase Vault via the service-role-only
 * `store_up_token` RPC. The token is never returned to the client.
 */

import { UpClient } from '../_shared/up.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveMemberWithAdmin } from '../_shared/caller.ts'
import { runConnect } from './connect.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: { token?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Captured from member resolution so storeToken can reuse the service client.
  const { resolveMember, admin } = resolveMemberWithAdmin(request)

  const result = await runConnect(body.token, {
    validateToken: (token) => new UpClient(token).ping(),
    resolveMember,
    storeToken: async (memberId, token) => {
      const { error } = await admin().rpc('store_up_token', {
        p_member_id: memberId,
        p_token: token,
      })
      return !error
    },
  })

  return json(result.body, result.status)
})
