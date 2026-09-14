/**
 * The connect-complete flow, with its I/O injected so the decision logic is
 * unit-tested without a network or database. `index.ts` wires the real caller
 * resolution, Redbark Link Session/Connection reads, and the
 * `redbark_connection` upsert.
 *
 * The frontend carries `linkSessionId` through the Fiskil redirect round trip
 * itself (there is no server-side pending-session table) and calls this once
 * the member returns. A `pending` session is a normal, expected state while
 * Fiskil's consent flow is still open, not an error — it is reported as
 * `{ connected: false, status: 'pending' }` (200) so the frontend can keep
 * polling. Once the session has completed, the resulting connection is
 * recorded against the caller's own member and household — never a
 * client-supplied id.
 *
 * Triggering a sync for the newly connected accounts is left to the frontend
 * (calling `redbark-sync` itself once this returns `{ connected: true }`)
 * rather than an edge-function-to-edge-function call: nothing else in this
 * codebase invokes one function from another.
 */

export interface FlowResult {
  status: number
  body: Record<string, unknown>
}

export interface CallerOutcome {
  memberId?: string
  householdId?: string
  error?: { status: number; message: string }
}

export interface LinkSessionStatus {
  status: string
  connection: string | null
  failure_reason: string | null
}

export interface ConnectionDetails {
  status: string
  institutionName: string | null
}

export interface CompleteDeps {
  /** Resolves the caller's own member and household id, or an error outcome. */
  resolveCaller: () => Promise<CallerOutcome>
  /** Reads the Link Session's current status. */
  getLinkSession: (id: string) => Promise<LinkSessionStatus>
  /** Reads the resulting connection's institution and status. */
  getConnection: (connectionId: string) => Promise<ConnectionDetails>
  /** Upserts the local redbark_connection row; true on success. */
  upsertConnection: (row: {
    id: string
    householdId: string
    memberId: string
    institutionName: string | null
    status: string
  }) => Promise<boolean>
}

/** Trims a raw body value to a link session id string, or empty when absent/ill-typed. */
export function normaliseLinkSessionId(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export async function runComplete(
  rawLinkSessionId: unknown,
  deps: CompleteDeps,
): Promise<FlowResult> {
  const linkSessionId = normaliseLinkSessionId(rawLinkSessionId)
  if (!linkSessionId) {
    return { status: 400, body: { error: 'A linkSessionId is required.' } }
  }

  const caller = await deps.resolveCaller()
  if (caller.error || !caller.memberId || !caller.householdId) {
    const error = caller.error ??
      { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  let session: LinkSessionStatus
  try {
    session = await deps.getLinkSession(linkSessionId)
  } catch (error) {
    return {
      status: 502,
      body: { error: `Failed to read the Redbark link session: ${(error as Error).message}` },
    }
  }

  if (session.status === 'pending') {
    return { status: 200, body: { connected: false, status: 'pending' } }
  }

  if (session.status !== 'completed' || !session.connection) {
    return {
      status: 200,
      body: { connected: false, status: 'failed', reason: session.failure_reason },
    }
  }

  let connection: ConnectionDetails
  try {
    connection = await deps.getConnection(session.connection)
  } catch (error) {
    return {
      status: 502,
      body: { error: `Failed to read the Redbark connection: ${(error as Error).message}` },
    }
  }

  const stored = await deps.upsertConnection({
    id: session.connection,
    householdId: caller.householdId,
    memberId: caller.memberId,
    institutionName: connection.institutionName,
    status: connection.status,
  })
  if (!stored) {
    return { status: 500, body: { error: 'Failed to record the Redbark connection.' } }
  }

  return { status: 200, body: { connected: true } }
}
