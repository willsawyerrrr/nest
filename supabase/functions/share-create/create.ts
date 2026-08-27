/**
 * Mints (or replaces) the caller's household's EOFY share and, when Resend is
 * configured, emails the link to the recipient. Kept a pure module with its
 * I/O injected — resolving the caller, minting the grant, loading the Resend
 * key, and sending the email are all deps — so the ordering (resolve the
 * caller before minting, mint before ever touching Resend) is unit-tested
 * without a network.
 *
 * The grant is minted regardless of whether Resend is configured or the send
 * succeeds: an email failure must never invalidate a grant already written,
 * so `share-create` always answers with the token and lets the PWA offer it
 * as a Copy Link fallback. `index.ts` wires the real caller resolution
 * (`_shared/caller.ts`), the `create_share_grant` RPC (run as the caller, so
 * `auth.uid()` resolves), the `resend_api_key()` Vault read, and the Resend
 * API call.
 */

import type { CallerError } from '../_shared/caller.ts'

export interface FlowResult {
  status: number
  body: unknown
}

export interface MintedGrant {
  token: string
  expiresAt: string
}

export interface ShareEmail {
  to: string
  /** The full share-link URL, built from the operator's configured app URL. */
  url: string
  expiresAt: string
}

export interface ShareCreateDeps {
  /** Resolves the caller; an error here means no member/JWT resolves at all. */
  resolveCaller: () => Promise<{ error?: CallerError }>
  /** Runs `create_share_grant` as the caller, so `auth.uid()` resolves as them. */
  mintGrant: (
    financialYear: number,
    recipientEmail: string,
  ) => Promise<MintedGrant | { error: CallerError }>
  /** The Resend API key from Vault; null when the operator has not set one. */
  loadResendKey: () => Promise<string | null>
  /** Sends the share-link email; true on success. */
  sendEmail: (apiKey: string, email: ShareEmail) => Promise<boolean>
  /** The PWA's base URL (no trailing slash required), for building the share link. */
  appUrl: string
}

export interface ShareCreateBody {
  token: string
  expiresAt: string
  emailSent: boolean
}

function normaliseFinancialYear(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) ? raw : null
}

/** Trims a raw body value to an email string, or empty when absent/ill-typed. */
function normaliseEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/** Builds the share link a recipient opens, from the operator's configured app URL. */
export function shareUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/share/eofy/${token}`
}

export async function runShareCreate(
  rawFinancialYear: unknown,
  rawRecipientEmail: unknown,
  deps: ShareCreateDeps,
): Promise<FlowResult> {
  const financialYear = normaliseFinancialYear(rawFinancialYear)
  const recipientEmail = normaliseEmail(rawRecipientEmail)
  if (financialYear === null || !recipientEmail) {
    return {
      status: 400,
      body: { error: 'A financial year and recipient email are required.' },
    }
  }

  const callerOutcome = await deps.resolveCaller()
  if (callerOutcome.error) {
    return { status: callerOutcome.error.status, body: { error: callerOutcome.error.message } }
  }

  const minted = await deps.mintGrant(financialYear, recipientEmail)
  if ('error' in minted) {
    return { status: minted.error.status, body: { error: minted.error.message } }
  }
  const { token, expiresAt } = minted

  const resendKey = await deps.loadResendKey()
  const emailSent = resendKey
    ? await deps.sendEmail(resendKey, {
      to: recipientEmail,
      url: shareUrl(deps.appUrl, token),
      expiresAt,
    })
    : false

  const body: ShareCreateBody = { token, expiresAt, emailSent }
  return { status: 200, body }
}
