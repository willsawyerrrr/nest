/**
 * Disconnect a member's Up token. JWT-verified: the caller is resolved to their
 * own member from the Authorization JWT (never the body), then their Vault
 * secret is removed via the service-role-only `clear_up_token` RPC.
 */

import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveMemberWithAdmin } from '../_shared/caller.ts'
import { runDisconnect } from './disconnect.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  // Captured from member resolution so clearToken can reuse the service client.
  const { resolveMember, admin } = resolveMemberWithAdmin(request)

  const result = await runDisconnect({
    resolveMember,
    clearToken: async (memberId) => {
      const { error } = await admin().rpc('clear_up_token', { p_member_id: memberId })
      return !error
    },
  })

  return json(result.body, result.status)
})
