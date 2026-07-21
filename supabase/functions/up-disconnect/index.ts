/**
 * Disconnect a member's Up token. JWT-verified: the caller is resolved to their
 * own member from the Authorization JWT (never the body), then their Vault
 * secret is removed via the service-role-only `clear_up_token` RPC.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveCaller } from '../_shared/caller.ts'
import { runDisconnect } from './disconnect.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  // Captured from member resolution so clearToken can reuse the service client.
  let admin: SupabaseClient | null = null

  const result = await runDisconnect({
    resolveMember: async () => {
      const resolved = await resolveCaller(request)
      if ('error' in resolved) {
        return { error: resolved.error }
      }
      admin = resolved.caller.admin
      return { memberId: resolved.caller.memberId }
    },
    clearToken: async (memberId) => {
      const { error } = await admin!.rpc('clear_up_token', { p_member_id: memberId })
      return !error
    },
  })

  return json(result.body, result.status)
})
