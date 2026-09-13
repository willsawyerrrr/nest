/**
 * Disconnect a Redbark bank connection. JWT-verified: the caller is resolved to
 * their own member from the Authorization JWT (never the body), then their
 * ownership of the named connection is checked against the local
 * `redbark_connection` row before anything is revoked.
 *
 * Takes `{ connectionId }`, revokes it with Redbark
 * (`RedbarkClient.deleteConnection`) — treating Redbark's `connection_not_found`
 * error as success, since the connection is gone either way — then deletes the
 * local row.
 */

import { RedbarkApiError, RedbarkClient } from '../_shared/redbark.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveMemberWithAdmin } from '../_shared/caller.ts'
import { runDisconnect } from './disconnect.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: { connectionId?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const apiKey = Deno.env.get('REDBARK_API_KEY')
  if (!apiKey) {
    return json({ error: 'Redbark is not configured' }, 500)
  }
  const client = new RedbarkClient(apiKey)

  const { resolveMember, admin } = resolveMemberWithAdmin(request)

  const result = await runDisconnect(body.connectionId, {
    resolveMember,
    findConnection: async (connectionId) => {
      const { data, error } = await admin()
        .from('redbark_connection')
        .select('member_id')
        .eq('id', connectionId)
        .maybeSingle()
      if (error || !data) return null
      return { memberId: data.member_id as string }
    },
    revokeConnection: async (connectionId) => {
      try {
        await client.deleteConnection(connectionId)
      } catch (error) {
        if (error instanceof RedbarkApiError && error.code === 'connection_not_found') {
          return
        }
        throw error
      }
    },
    deleteConnection: async (connectionId) => {
      const { error } = await admin().from('redbark_connection').delete().eq('id', connectionId)
      return !error
    },
  })

  return json(result.body, result.status)
})
