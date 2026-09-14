/**
 * Start a Redbark bank connection for the caller's own member. JWT-verified:
 * the caller is resolved to their own member from the Authorization JWT (never
 * the body).
 *
 * Takes `{ returnUrl }` and starts a Redbark Link Session
 * (`RedbarkClient.createLinkSession`), returning `{ linkSessionId, url }` — the
 * frontend redirects the browser to `url`, where the member completes Fiskil's
 * consent flow before Redbark sends them back to `returnUrl`. The frontend is
 * responsible for carrying `linkSessionId` through that round trip (e.g. in
 * `sessionStorage`) and calling `redbark-connect-complete` with it afterwards;
 * nothing about the pending session is persisted server-side.
 */

import { RedbarkClient } from '../_shared/redbark.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveMemberWithAdmin } from '../_shared/caller.ts'
import { runConnect } from './connect.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: { returnUrl?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const apiKey = Deno.env.get('REDBARK_API_KEY')
  if (!apiKey) {
    return json({ error: 'Redbark is not configured' }, 500)
  }

  const { resolveMember } = resolveMemberWithAdmin(request)

  const result = await runConnect(body.returnUrl, {
    resolveMember,
    createLinkSession: (returnUrl) => new RedbarkClient(apiKey).createLinkSession(returnUrl),
  })

  return json(result.body, result.status)
})
