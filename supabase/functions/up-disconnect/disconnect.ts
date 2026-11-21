/**
 * The disconnect flow, with its I/O injected so the decision logic is
 * unit-tested without a network or database. `index.ts` wires the real member
 * resolution, webhook removal, and Vault clear.
 */

import type { FlowResult, MemberOutcome } from '../up-connect/connect.ts'

export interface DisconnectDeps {
  /** Resolves the caller's own member id, or an error outcome. */
  resolveMember: () => Promise<MemberOutcome>
  /**
   * Deletes the member's Up webhook (best effort at Up) and clears its stored id
   * and secret; true when the clear succeeds.
   */
  removeWebhook: (memberId: string) => Promise<boolean>
  /** Removes the member's stored token; true on success. */
  clearToken: (memberId: string) => Promise<boolean>
}

/**
 * Removes the caller's webhook, then their token: the webhook goes first because
 * deleting it at Up needs the token.
 */
export async function runDisconnect(deps: DisconnectDeps): Promise<FlowResult> {
  const outcome = await deps.resolveMember()
  if (outcome.error || !outcome.memberId) {
    const error = outcome.error ?? { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  if (
    !(await deps.removeWebhook(outcome.memberId)) || !(await deps.clearToken(outcome.memberId))
  ) {
    return { status: 500, body: { error: 'Failed to disconnect.' } }
  }

  return { status: 200, body: { connected: false } }
}
