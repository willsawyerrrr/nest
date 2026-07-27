/**
 * Serves the Web Push VAPID public key, so the PWA can pass it to
 * `pushManager.subscribe({ applicationServerKey })`. JWT-verified (the default),
 * so only a signed-in household member can read it.
 *
 * The key is served rather than baked in as a build-time env var: rotating the
 * keypair is then a Vault change alone, with no rebuild and no stale installed
 * PWA holding a key the server has stopped signing with.
 */

import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveMemberWithAdmin } from '../_shared/caller.ts'
import { loadVapidKeys } from '../_shared/vapid.ts'
import { runPushKey } from './key.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  // Captured from member resolution so the Vault read reuses the service client.
  const { resolveMember, admin } = resolveMemberWithAdmin(request)

  const result = await runPushKey({
    resolveMember,
    loadPublicKey: async () => (await loadVapidKeys(admin()))?.publicKey ?? null,
  })

  return json(result.body, result.status)
})
