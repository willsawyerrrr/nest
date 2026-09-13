/**
 * Complete a Redbark bank connection for the caller's own member. JWT-verified:
 * the caller is resolved to their own member and household from the
 * Authorization JWT (never the body).
 *
 * Takes `{ linkSessionId }` (the id `redbark-connect` returned, carried through
 * the Fiskil redirect round trip by the frontend) and resolves it via
 * `RedbarkClient.getLinkSession`. A `pending` session reports
 * `{ connected: false, status: 'pending' }`; a failed or connection-less one
 * reports `{ connected: false, status: 'failed', reason }`; a completed one
 * reads the resulting connection's institution name
 * (`RedbarkClient.getConnection`), upserts a `redbark_connection` row keyed on
 * the connection id, and reports `{ connected: true }`. Refreshing the newly
 * connected accounts is the frontend's job — call `redbark-sync` once this
 * returns `connected: true`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { RedbarkClient } from '../_shared/redbark.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveCaller } from '../_shared/caller.ts'
import { runComplete } from './complete.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: { linkSessionId?: unknown }
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

  // Captured once the caller resolves, so upsertConnection can reuse the same
  // service-role client.
  let admin: SupabaseClient | null = null

  const result = await runComplete(body.linkSessionId, {
    resolveCaller: async () => {
      const resolved = await resolveCaller(request)
      if ('error' in resolved) {
        return { error: resolved.error }
      }
      admin = resolved.caller.admin
      const { data, error } = await admin
        .from('members')
        .select('household_id')
        .eq('id', resolved.caller.memberId)
        .maybeSingle()
      if (error || !data) {
        return { error: { status: 500, message: 'Could not resolve household' } }
      }
      return { memberId: resolved.caller.memberId, householdId: data.household_id as string }
    },
    getLinkSession: (id) => client.getLinkSession(id),
    getConnection: async (id) => {
      const connection = await client.getConnection(id)
      return { status: connection.status, institutionName: connection.institution?.name ?? null }
    },
    upsertConnection: async ({ id, householdId, memberId, institutionName, status }) => {
      const { error } = await admin!.from('redbark_connection').upsert({
        id,
        household_id: householdId,
        member_id: memberId,
        institution_name: institutionName,
        status,
      })
      return !error
    },
  })

  return json(result.body, result.status)
})
