/**
 * The disconnect flow, with its I/O injected so the decision logic is
 * unit-tested without a network or database. `index.ts` wires the real
 * connection lookup, Redbark revoke, and local row delete.
 *
 * Takes `{ connectionId }`. A member can only disconnect their own connection
 * — the row's `member_id` is checked against the caller's own, mirroring Up's
 * per-member disconnect — so looking the row up is the security-relevant step
 * before anything is revoked or deleted: a 404 when the row does not exist, a
 * 403 when it belongs to a different member.
 */

export interface FlowResult {
  status: number
  body: Record<string, unknown>
}

export interface MemberOutcome {
  memberId?: string
  error?: { status: number; message: string }
}

export interface ConnectionOwner {
  memberId: string
}

export interface DisconnectDeps {
  /** Resolves the caller's own member id, or an error outcome. */
  resolveMember: () => Promise<MemberOutcome>
  /** Looks up the connection's owning member; null when the row does not exist. */
  findConnection: (connectionId: string) => Promise<ConnectionOwner | null>
  /**
   * Revokes the connection with Redbark. Resolves (rather than throwing) when
   * Redbark reports the connection as already gone, so a connection already
   * revoked upstream still disconnects cleanly here.
   */
  revokeConnection: (connectionId: string) => Promise<void>
  /** Deletes the local redbark_connection row; true on success. */
  deleteConnection: (connectionId: string) => Promise<boolean>
}

export async function runDisconnect(
  rawConnectionId: unknown,
  deps: DisconnectDeps,
): Promise<FlowResult> {
  const connectionId = typeof rawConnectionId === 'string' ? rawConnectionId.trim() : ''
  if (!connectionId) {
    return { status: 400, body: { error: 'A connectionId is required.' } }
  }

  const outcome = await deps.resolveMember()
  if (outcome.error || !outcome.memberId) {
    const error = outcome.error ??
      { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  const connection = await deps.findConnection(connectionId)
  if (!connection) {
    return { status: 404, body: { error: 'No such Redbark connection.' } }
  }
  if (connection.memberId !== outcome.memberId) {
    return { status: 403, body: { error: 'That connection belongs to another member.' } }
  }

  try {
    await deps.revokeConnection(connectionId)
  } catch (error) {
    return {
      status: 502,
      body: { error: `Failed to revoke the Redbark connection: ${(error as Error).message}` },
    }
  }

  if (!(await deps.deleteConnection(connectionId))) {
    return { status: 500, body: { error: 'Failed to disconnect.' } }
  }

  return { status: 200, body: { connected: false } }
}
