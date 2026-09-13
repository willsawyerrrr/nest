/**
 * The connect flow, with its I/O injected so the decision logic is unit-tested
 * without a network or database. `index.ts` wires the real member resolution
 * and Redbark Link Session creation.
 *
 * Unlike `up-connect` there is no client-supplied credential to validate: the
 * platform-wide Redbark API key is already trusted server-side infrastructure,
 * so the only step before starting a session is resolving the caller's own
 * member from their JWT (never the body).
 */

export interface FlowResult {
  status: number
  body: Record<string, unknown>
}

export interface MemberOutcome {
  memberId?: string
  error?: { status: number; message: string }
}

export interface LinkSession {
  id: string
  url: string
}

export interface ConnectDeps {
  /** Resolves the caller's own member id, or an error outcome. */
  resolveMember: () => Promise<MemberOutcome>
  /** Starts a Redbark Link Session that redirects back to `returnUrl` on completion. */
  createLinkSession: (returnUrl: string) => Promise<LinkSession>
}

/** Trims a raw body value to a return URL string, or empty when absent/ill-typed. */
export function normaliseReturnUrl(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export async function runConnect(rawReturnUrl: unknown, deps: ConnectDeps): Promise<FlowResult> {
  const returnUrl = normaliseReturnUrl(rawReturnUrl)
  if (!returnUrl) {
    return { status: 400, body: { error: 'A returnUrl is required.' } }
  }

  const outcome = await deps.resolveMember()
  if (outcome.error || !outcome.memberId) {
    const error = outcome.error ??
      { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  let session: LinkSession
  try {
    session = await deps.createLinkSession(returnUrl)
  } catch (error) {
    return {
      status: 502,
      body: { error: `Failed to start a Redbark connection: ${(error as Error).message}` },
    }
  }

  return { status: 200, body: { linkSessionId: session.id, url: session.url } }
}
