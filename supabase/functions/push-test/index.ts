/**
 * Fires a test notification to every device the caller has opted in — Web Push
 * subscriptions and native APNs installs — so the chain (device row, credentials,
 * push service, the device itself) can be verified end to end. JWT-verified: the member is resolved from the Authorization JWT
 * (never the body), so a caller can only ever push to their own devices.
 */

import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveMemberWithAdmin } from '../_shared/caller.ts'
import { type ApnsDevice, createApnsSender, loadApnsKeys } from '../_shared/apns.ts'
import { loadVapidKeys } from '../_shared/vapid.ts'
import { createPushSender } from '../_shared/webpush.ts'
import { type PushDevice, runPushTest } from './send.ts'

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
        return await createPushSender(keys)
      } catch {
        // A malformed stored keypair is a misconfiguration, reported as one.
        return null
      }
    },
    prune: async (ids) => {
      const { error } = await admin().from('push_subscription').delete().in('id', ids)
      return !error
    },
    loadApnsDevices: async (memberId) => {
      const { data, error } = await admin()
        .from('apns_device')
        .select('id, token, environment')
        .eq('member_id', memberId)
      return error ? null : (data as ApnsDevice[])
    },
    loadApnsSender: async () => {
      const keys = await loadApnsKeys(admin())
      if (!keys) return null
      try {
        return await createApnsSender(keys)
      } catch {
        // A malformed stored key is a misconfiguration, reported as one.
        return null
      }
    },
    pruneApns: async (ids) => {
      const { error } = await admin().from('apns_device').delete().in('id', ids)
      return !error
    },
  })

  return json(result.body, result.status)
})
