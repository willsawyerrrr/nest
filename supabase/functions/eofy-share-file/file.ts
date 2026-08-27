/**
 * Mints a short-lived signed URL for one file a tax agent's shared EOFY view
 * links to — a deduction receipt or a payslip document — from a validated
 * share token. This is the feature's main new security surface: the token
 * holder must get a signed URL only for a file legitimately part of THIS
 * share's household and financial year, never blanket Storage access, so the
 * scope check below is the whole of the boundary rather than a convenience on
 * top of one Storage RLS already provides — an anonymous bearer has no
 * `auth.uid()`, so the bucket's own household-membership policy never applies
 * to it either way.
 *
 * Kept a pure module with its I/O injected — resolving the grant, checking
 * scope, and minting the URL are all deps — so the ordering (resolve, then
 * validate the request shape, then the household-prefix check, then the
 * scope query, and only then sign) is unit-tested without a network.
 * `index.ts` wires the real token resolution, database scope checks, and
 * Storage signing.
 */

import type { CallerError } from '../_shared/caller.ts'
import type { ShareGrant } from '../_shared/shareGrant.ts'

export interface FlowResult {
  status: number
  body: unknown
}

export type ShareFileBucket = 'receipts' | 'payslips'

/** How long a share's signed URL stays valid, in seconds — shorter than the household's own 3600s (`usePayslips`/`useDeductionReceipts`), since this is a lower-trust anonymous bearer. */
export const SHARE_FILE_SIGNED_URL_TTL_SECONDS = 300

export interface EofyShareFileDeps {
  /** Resolves the bearer token to its grant, or an error outcome. */
  resolveGrant: (token: string) => Promise<{ grant: ShareGrant } | { error: CallerError }>
  /** True when `path` is a legitimate object under `bucket` for this grant's household and financial year. */
  isPathInScope: (bucket: ShareFileBucket, path: string, grant: ShareGrant) => Promise<boolean>
  /** Mints a signed URL for `path` in `bucket`; null when Storage cannot produce one. */
  createSignedUrl: (bucket: ShareFileBucket, path: string) => Promise<string | null>
}

function normaliseBucket(raw: unknown): ShareFileBucket | null {
  return raw === 'receipts' || raw === 'payslips' ? raw : null
}

/** Trims a raw body value to a safe object path, or empty when absent, rooted, or traversing. */
function normalisePath(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const path = raw.trim()
  if (!path || path.startsWith('/')) return ''
  const segments = path.split('/')
  if (segments.length < 2 || segments.some((segment) => segment === '' || segment === '..')) {
    return ''
  }
  return path
}

/** The household a bucket path belongs to: its first segment. */
function householdSegment(path: string): string {
  return path.split('/')[0]
}

export async function runEofyShareFile(
  rawToken: unknown,
  rawBucket: unknown,
  rawPath: unknown,
  deps: EofyShareFileDeps,
): Promise<FlowResult> {
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''
  const resolved = await deps.resolveGrant(token)
  if ('error' in resolved) {
    return { status: resolved.error.status, body: { error: resolved.error.message } }
  }
  const { grant } = resolved

  const bucket = normaliseBucket(rawBucket)
  const path = normalisePath(rawPath)
  if (!bucket || !path) {
    return { status: 400, body: { error: 'A bucket and file path are required.' } }
  }

  // Defence in depth ahead of the scope query below: a path outside the
  // grant's own household prefix is rejected before it is ever looked up.
  if (householdSegment(path) !== grant.householdId) {
    return { status: 403, body: { error: 'That file is not part of this share.' } }
  }

  if (!(await deps.isPathInScope(bucket, path, grant))) {
    return { status: 403, body: { error: 'That file is not part of this share.' } }
  }

  const url = await deps.createSignedUrl(bucket, path)
  if (!url) {
    return { status: 404, body: { error: 'That file could not be found.' } }
  }

  return { status: 200, body: { url, expiresIn: SHARE_FILE_SIGNED_URL_TTL_SECONDS } }
}
