/**
 * Disconnect a member's Up token. JWT-verified: the caller is resolved to their
 * own member from the Authorization JWT (never the body), then their Up webhook
 * is deleted (best effort at Up; its stored id and secret cleared via
 * `clear_up_webhook`) and their Vault token removed via the service-role-only
 * `clear_up_token` RPC.
 */

import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveMemberWithAdmin } from '../_shared/caller.ts'
import { unregisterWithUp } from '../_shared/upWebhook.ts'
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
    removeWebhook: async (memberId) => {
      const { data: token } = await admin().rpc('up_token_for_member', { p_member_id: memberId })
      return unregisterWithUp(admin(), memberId, token ?? null)
    },
    clearToken: async (memberId) => {
      const { error } = await admin().rpc('clear_up_token', { p_member_id: memberId })
      return !error
    },
  })

  return json(result.body, result.status)
})
