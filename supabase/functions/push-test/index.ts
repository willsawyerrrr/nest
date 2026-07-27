/**
 * Fires a test Web Push to every device the caller has opted in, so the chain —
 * subscription row, VAPID keys, push service, service worker — can be verified
 * end to end. JWT-verified: the member is resolved from the Authorization JWT
 * (never the body), so a caller can only ever push to their own devices.
 */

import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveMemberWithAdmin } from '../_shared/caller.ts'
import { loadVapidKeys } from '../_shared/vapid.ts'
import { type PushDevice, runPushTest } from './send.ts'
import { createSender } from './webpush.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  // Captured from member resolution so the reads below reuse the service client.
  const { resolveMember, admin } = resolveMemberWithAdmin(request)

  const result = await runPushTest({
    resolveMember,
    loadDevices: async (memberId) => {
      const { data, error } = await admin()
        .from('push_subscription')
        .select('id, endpoint, p256dh, auth')
        .eq('member_id', memberId)
      return error ? null : (data as PushDevice[])
    },
    loadSender: async () => {
      const keys = await loadVapidKeys(admin())
      if (!keys) return null
      try {
        return await createSender(keys)
      } catch {
        // A malformed stored keypair is a misconfiguration, reported as one.
        return null
      }
    },
    prune: async (ids) => {
      const { error } = await admin().from('push_subscription').delete().in('id', ids)
      return !error
    },
  })

  return json(result.body, result.status)
})
