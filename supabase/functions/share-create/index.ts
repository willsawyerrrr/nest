/**
 * Mints (or replaces) the caller's household's EOFY share, called from the
 * EOFY tab's share-creation control. JWT-verified (the default): the caller
 * is resolved from their Authorization JWT via `_shared/caller.ts`, and
 * `create_share_grant` runs on their own JWT-scoped client (`asUser`) so
 * `auth.uid()` inside the RPC resolves as them — the service-role client is
 * used only for the Resend key read, never for the mint itself.
 *
 * When the operator has set a `resend_api_key` Vault secret, the share link
 * is emailed to the recipient via the Resend API; the grant is minted either
 * way, so an email failure never leaves the household without a link — the
 * response's `emailSent` tells the PWA whether to lean on its Copy Link
 * fallback.
 */

import { resolveCaller, type ResolvedCaller } from '../_shared/caller.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { type MintedGrant, runShareCreate, type ShareEmail } from './create.ts'

/** The Resend sending identity; override via `RESEND_FROM_ADDRESS` once a sending domain is verified. */
const DEFAULT_FROM_ADDRESS = 'Nest <onboarding@resend.dev>'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: { financialYear?: unknown; recipientEmail?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Captured by the resolveCaller dep below and reused for the mint and the
  // Resend-key read, so the caller is resolved exactly once.
  let caller: ResolvedCaller | null = null

  const result = await runShareCreate(body.financialYear, body.recipientEmail, {
    resolveCaller: async () => {
      const resolved = await resolveCaller(request)
      if ('error' in resolved) return { error: resolved.error }
      caller = resolved.caller
      return {}
    },
    mintGrant: async (financialYear, recipientEmail) => {
      const { data, error } = await caller!.asUser.rpc('create_share_grant', {
        p_financial_year: financialYear,
        p_recipient_email: recipientEmail,
      })
      if (error) {
        return { error: { status: 500, message: 'Could not create the share.' } }
      }
      // `returns table (...)` surfaces as a one-row array through PostgREST.
      const row = (Array.isArray(data) ? data[0] : data) as {
        token: string
        expires_at: string
      }
      return { token: row.token, expiresAt: row.expires_at } satisfies MintedGrant
    },
    loadResendKey: async () => {
      const { data, error } = await caller!.admin.rpc('resend_api_key')
      if (error) return null
      const key = typeof data === 'string' ? data.trim() : ''
      return key || null
    },
    sendEmail: (apiKey, email) => sendShareEmail(apiKey, email),
    appUrl: Deno.env.get('PWA_APP_URL') ?? '',
  })

  return json(result.body, result.status)
})

/** Sends the share-link email via the Resend API; true only on a successful (2xx) response. */
async function sendShareEmail(apiKey: string, email: ShareEmail): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM_ADDRESS') ?? DEFAULT_FROM_ADDRESS,
        to: email.to,
        subject: 'Your household shared an EOFY summary with you',
        html: shareEmailHtml(email),
      }),
    })
    return response.ok
  } catch {
    return false
  }
}

/** The share-link email body: the link, and when it expires — nothing else about the household. */
function shareEmailHtml({ url, expiresAt }: ShareEmail): string {
  const expiry = new Date(expiresAt).toUTCString()
  return `
    <p>A household has shared their EOFY tax summary with you via Nest.</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link expires ${expiry} and can be revoked by the household at any time.</p>
    <p>The figures behind it are estimates for planning purposes, not a filed tax return.</p>
  `.trim()
}
