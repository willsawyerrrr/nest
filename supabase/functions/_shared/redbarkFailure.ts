import { RedbarkApiError } from './redbark.ts'

/** The stable error codes a failed Redbark call is reported to clients as. */
export type RedbarkFailureCode =
  | 'plan_upgrade_required'
  | 'redbark_auth_failed'
  | 'redbark_unavailable'

const FAILURES: Record<RedbarkFailureCode, { status: number; error: string }> = {
  plan_upgrade_required: {
    status: 503,
    error: 'Bank connections need the Redbark Developer or Professional plan.',
  },
  redbark_auth_failed: {
    status: 500,
    error: 'Bank connections are misconfigured. Try again later.',
  },
  redbark_unavailable: {
    status: 502,
    error: 'Redbark is unavailable right now. Try again shortly.',
  },
}

/** Classifies a Redbark failure: a plan without API access, a rejected key, or anything else. */
export function redbarkFailureCode(error: unknown): RedbarkFailureCode {
  if (error instanceof RedbarkApiError) {
    if (error.code === 'plan_upgrade_required') return 'plan_upgrade_required'
    if (error.status === 401 || error.status === 403) return 'redbark_auth_failed'
  }
  return 'redbark_unavailable'
}

/**
 * Maps a failed Redbark call to our own `{ code, error }` response, logging the
 * upstream detail (status, body, request id) server-side. Nothing from the
 * upstream response reaches the client: `error` is fixed copy per `code`.
 * `action` names the step that failed, for the log line.
 */
export function redbarkFailure(
  error: unknown,
  action: string,
): { status: number; body: { code: RedbarkFailureCode; error: string } } {
  console.error(`Redbark ${action} failed:`, error)
  const code = redbarkFailureCode(error)
  const { status, error: message } = FAILURES[code]
  return { status, body: { code, error: message } }
}
