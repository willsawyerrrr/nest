/**
 * The disconnect flow, with its I/O injected so the decision logic is
 * unit-tested without a network or database. `index.ts` wires the real member
 * resolution and Vault clear.
 */

import type { FlowResult, MemberOutcome } from '../up-connect/connect.ts'

export interface DisconnectDeps {
  /** Resolves the caller's own member id, or an error outcome. */
  resolveMember: () => Promise<MemberOutcome>
  /** Removes the member's stored token; true on success. */
  clearToken: (memberId: string) => Promise<boolean>
}

export async function runDisconnect(deps: DisconnectDeps): Promise<FlowResult> {
  const outcome = await deps.resolveMember()
  if (outcome.error || !outcome.memberId) {
    const error = outcome.error ?? { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  if (!(await deps.clearToken(outcome.memberId))) {
    return { status: 500, body: { error: 'Failed to disconnect.' } }
  }

  return { status: 200, body: { connected: false } }
}
