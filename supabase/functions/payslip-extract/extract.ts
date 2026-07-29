/**
 * The extraction flow, with its I/O injected so the ordering and the failure
 * behaviour are unit-tested without a network, a database, or a model. `index.ts`
 * wires the real household resolution, Vault key read, Storage download, and
 * Anthropic call.
 *
 * **Extraction never writes a payslip figure anywhere.** It returns the fields it
 * read; the client pre-fills the manual entry form, the member confirms, and the
 * member's own save is what persists. There is deliberately no write path here —
 * no table, no RPC, no Storage write — because a wrong tax figure saved silently
 * is worse than no extraction at all. It follows that a failure at any step can
 * leave nothing partially written.
 *
 * The client uploads the file first (the file is the auditable record whether or
 * not extraction succeeds), so the request carries the Storage object path rather
 * than bytes. A client-supplied path is not trusted: its first segment must be
 * the caller's own household, which is defence in depth on top of Storage RLS.
 */

import { type PayslipExtraction, toExtraction } from './fields.ts'
import {
  maxBytesFor,
  type ModelResult,
  PAYSLIP_MODEL,
  type PayslipFile,
  resolveMediaType,
  SUPPORTED_MEDIA_TYPES,
} from './model.ts'

/** The private bucket the client uploads payslip files to. */
export const PAYSLIPS_BUCKET = 'payslips'

export interface FlowResult {
  status: number
  body: unknown
}

export interface FlowError {
  status: number
  message: string
}

/** The caller's own household, resolved from their JWT. */
export interface HouseholdOutcome {
  householdId?: string
  error?: FlowError
}

/** An object read from the payslips bucket. */
export interface DownloadedObject {
  bytes: Uint8Array
  /** What Storage recorded on upload; often absent or `application/octet-stream`. */
  contentType: string | null
}

export interface ExtractDeps {
  /** Resolves the caller to their own household id, or an error outcome. */
  resolveHousehold: () => Promise<HouseholdOutcome>
  /** The Anthropic API key from Vault; null when the operator has not set it. */
  apiKey: () => Promise<string | null>
  /** Downloads the object, or null when it is not in the bucket. */
  downloadObject: (path: string) => Promise<DownloadedObject | null>
  /** Sends the file to the model. */
  extract: (file: PayslipFile, apiKey: string) => Promise<ModelResult>
}

/** The successful response body. */
export interface ExtractionBody extends PayslipExtraction {
  /** The pinned model that read the slip, so a stale client can tell. */
  model: string
}

/** Trims a raw body value to an object path, or empty when absent or unsafe. */
export function normalisePath(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const path = raw.trim()
  if (!path || path.startsWith('/')) return ''
  const segments = path.split('/')
  // A traversal or an empty segment would let a path escape its household prefix.
  if (segments.length < 2 || segments.some((segment) => segment === '' || segment === '..')) {
    return ''
  }
  return path
}

/** The household a bucket path belongs to: its first segment. */
export function householdSegment(path: string): string {
  return path.split('/')[0]
}

export async function runExtract(rawPath: unknown, deps: ExtractDeps): Promise<FlowResult> {
  const path = normalisePath(rawPath)
  if (!path) {
    return { status: 400, body: { error: 'A payslip file path is required.' } }
  }

  const household = await deps.resolveHousehold()
  if (household.error || !household.householdId) {
    const error = household.error ??
      { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  // Defence in depth over Storage RLS: the path is the client's, so it is checked
  // against the caller's own household before anything is read.
  if (householdSegment(path) !== household.householdId) {
    return { status: 403, body: { error: 'That file does not belong to your household.' } }
  }

  const apiKey = await deps.apiKey()
  if (!apiKey) {
    // An honest, specific degradation: the feature is off, not broken. The form
    // still takes the figures by hand.
    return {
      status: 503,
      body: {
        error: 'Payslip extraction is not configured. Enter the figures by hand.',
        configured: false,
      },
    }
  }

  const object = await deps.downloadObject(path)
  if (!object) {
    return { status: 404, body: { error: 'That payslip file could not be found.' } }
  }
  if (object.bytes.length === 0) {
    return { status: 400, body: { error: 'That payslip file is empty.' } }
  }

  const mediaType = resolveMediaType(object.contentType, path)
  if (!mediaType) {
    return {
      status: 415,
      body: {
        error: `That file type cannot be read. Upload a PDF, JPEG, PNG, or WebP (${
          SUPPORTED_MEDIA_TYPES.join(', ')
        }).`,
      },
    }
  }

  const maxBytes = maxBytesFor(mediaType)
  if (object.bytes.length > maxBytes) {
    return {
      status: 413,
      body: {
        error: `That file is too large to read (${
          megabytes(object.bytes.length)
        } MB; the limit is ${megabytes(maxBytes)} MB).`,
      },
    }
  }

  const result = await deps.extract({ mediaType, bytes: object.bytes }, apiKey)
  if (!result.ok) return modelFailure(result)

  if (!result.fields.is_payslip) {
    return {
      status: 422,
      body: {
        error: 'That file does not look like a payslip.',
        notPayslip: true,
        reason: result.fields.not_payslip_reason,
      },
    }
  }

  const body: ExtractionBody = { model: PAYSLIP_MODEL, ...toExtraction(result.fields) }
  return { status: 200, body }
}

/** One decimal place, enough for a size message. */
function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/** What a failure no retry can fix says: the figures are typed by hand instead. */
const UNREADABLE_MESSAGE = 'The payslip could not be read. Enter the figures by hand.'

/** Maps a model failure to a status the client can act on. */
function modelFailure(result: Extract<ModelResult, { ok: false }>): FlowResult {
  if (result.failure === 'no_credit') {
    // The same `503` shape as an unset key, because it is the same thing from
    // the member's side: reading is switched off pending an operator, not broken
    // and not their file. Retrying cannot help, so it is not offered. The flag is
    // its own rather than `configured: false` because the operator's fix differs
    // — top up the account, not set a Vault secret — and the client says which.
    return {
      status: 503,
      body: {
        error:
          'Payslip reading is off until the Anthropic account is topped up. Nothing is wrong with your file — enter the figures by hand.',
        outOfCredit: true,
      },
    }
  }
  if (result.failure === 'key_rejected') {
    // The third `503`, for the third thing only an operator can fix. A key that
    // is wrong, revoked, or not permitted reads to the member exactly as an unset
    // one does — reading is off, not broken, and not their file — so no retry is
    // offered, since the same key would be refused identically. Its own flag
    // again, because the fix is its own: rotate the Vault secret, rather than set
    // it for the first time or top the account up.
    return {
      status: 503,
      body: {
        error:
          'Payslip reading is off until the Anthropic API key is fixed. Nothing is wrong with your file — enter the figures by hand.',
        keyRejected: true,
      },
    }
  }
  if (result.failure === 'timeout') {
    return {
      status: 504,
      body: { error: 'Reading the payslip took too long. Try again, or enter it by hand.' },
    }
  }
  if (result.failure === 'malformed') {
    return { status: 502, body: { error: UNREADABLE_MESSAGE } }
  }
  if (result.failure === 'refused') {
    // Nothing is wrong with the server: the model would not read this file.
    return {
      status: 422,
      body: { error: 'That file could not be read. Enter the figures by hand.' },
    }
  }
  // A rate limit is worth passing through so the client can back off.
  if (result.status === 429) {
    return {
      status: 429,
      body: { error: 'Reading payslips is rate limited right now. Try again shortly.' },
    }
  }
  // Anything else upstream is a bad gateway from the caller's point of view, but
  // whether a retry can help depends on which side the fault is on: a `5xx` or a
  // request that never landed is a bad moment, while a `4xx` none of the cases
  // above claimed is a request the API rejected and will reject identically next
  // time, so that one is not invited to retry.
  const transient = result.status === undefined || result.status >= 500
  return {
    status: 502,
    body: {
      error: transient
        ? 'The payslip could not be read right now. Try again, or enter it by hand.'
        : UNREADABLE_MESSAGE,
    },
  }
}
