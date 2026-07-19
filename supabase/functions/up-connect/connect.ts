/**
 * The connect flow, with its I/O injected so the decision logic is unit-tested
 * without a network or database. `index.ts` wires the real Up ping, member
 * resolution, and Vault store; the ordering here (validate the token before
 * resolving the member or writing anything) is the security-relevant part.
 */

export interface FlowResult {
  status: number
  body: Record<string, unknown>
}

export interface MemberOutcome {
  memberId?: string
  error?: { status: number; message: string }
}

export interface ConnectDeps {
  /** True when Up accepts the token. */
  validateToken: (token: string) => Promise<boolean>
  /** Resolves the caller's own member id, or an error outcome. */
  resolveMember: () => Promise<MemberOutcome>
  /** Stores the token for the member; true on success. */
  storeToken: (memberId: string, token: string) => Promise<boolean>
}

/** Trims a raw body value to a token string, or empty when absent/ill-typed. */
export function normaliseToken(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export async function runConnect(rawToken: unknown, deps: ConnectDeps): Promise<FlowResult> {
  const token = normaliseToken(rawToken)
  if (!token) {
    return { status: 400, body: { error: 'A token is required.' } }
  }

  // Validate with Up before the token is ever stored or a member resolved.
  if (!(await deps.validateToken(token))) {
    return {
      status: 400,
      body: { error: 'That token was rejected by Up. Check it and try again.' },
    }
  }

  const outcome = await deps.resolveMember()
  if (outcome.error || !outcome.memberId) {
    const error = outcome.error ?? { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  if (!(await deps.storeToken(outcome.memberId, token))) {
    return { status: 500, body: { error: 'Failed to store the token.' } }
  }

  return { status: 200, body: { connected: true } }
}
