import { UpApiError } from './up.ts'

/** The stable error codes a failed Up call, or a missing Up token, is reported to clients as. */
export type UpFailureCode =
  | 'up_not_connected'
  | 'up_auth_failed'
  | 'up_rate_limited'
  | 'up_transaction_not_found'
  | 'up_rejected'
  | 'up_unavailable'

export const UP_FAILURES: Record<UpFailureCode, { status: number; error: string }> = {
  up_not_connected: {
    status: 409,
    error: 'Connect Up in Connections to recategorise transactions.',
  },
  up_auth_failed: {
    status: 409,
    error: 'Up rejected your token. Reconnect Up in Connections.',
  },
  up_rate_limited: {
    status: 429,
    error: 'Up is busy right now. Try again in a minute.',
  },
  up_transaction_not_found: {
    status: 404,
    error: 'Up has no such transaction for your token.',
  },
  up_rejected: {
    status: 422,
    error: 'Up would not accept that category for this transaction.',
  },
  up_unavailable: {
    status: 502,
    error: 'Up is unavailable right now. Try again shortly.',
  },
}

/**
 * Classifies a failed Up call: a rejected token (401/403), a rate limit (429,
 * retryable), a transaction the token cannot see (404), a refused request
 * (400/422), or anything else.
 */
export function upFailureCode(error: unknown): UpFailureCode {
  if (error instanceof UpApiError) {
    if (error.status === 401 || error.status === 403) return 'up_auth_failed'
    if (error.status === 429) return 'up_rate_limited'
    if (error.status === 404) return 'up_transaction_not_found'
    if (error.status === 400 || error.status === 422) return 'up_rejected'
  }
  return 'up_unavailable'
}

/** The `{ code, error }` response for `code`, its copy fixed per code. */
export function upFailureResponse(
  code: UpFailureCode,
): { status: number; body: { code: UpFailureCode; error: string } } {
  const { status, error } = UP_FAILURES[code]
  return { status, body: { code, error } }
}

/**
 * Maps a failed Up call to our own `{ code, error }` response, logging the
 * upstream detail server-side. Nothing from the upstream response reaches the
 * client: `error` is fixed copy per `code`. `action` names the step that
 * failed, for the log line.
 */
export function upFailure(
  error: unknown,
  action: string,
): { status: number; body: { code: UpFailureCode; error: string } } {
  console.error(`Up ${action} failed:`, error)
  return upFailureResponse(upFailureCode(error))
}
