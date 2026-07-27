/**
 * The VAPID public-key lookup, with its I/O injected so the decision logic is
 * unit-tested without a network or database. `index.ts` wires the real member
 * resolution and Vault read.
 */

import type { FlowResult, MemberOutcome } from '../up-connect/connect.ts'

export interface PushKeyDeps {
  /** Resolves the caller's own member id, or an error outcome. */
  resolveMember: () => Promise<MemberOutcome>
  /** The configured VAPID public key, or null when push is unavailable. */
  loadPublicKey: () => Promise<string | null>
}

export async function runPushKey(deps: PushKeyDeps): Promise<FlowResult> {
  const outcome = await deps.resolveMember()
  if (outcome.error || !outcome.memberId) {
    const error = outcome.error ?? { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  // Absent secrets are not a caller error but they are a real one — there is no
  // key to subscribe with — so this answers 503 rather than a null key a client
  // might pass to `applicationServerKey` unchecked. Matches `push-test`.
  const publicKey = await deps.loadPublicKey()
  if (!publicKey) {
    return { status: 503, body: { error: 'Push notifications are not configured.' } }
  }

  return { status: 200, body: { publicKey } }
}
