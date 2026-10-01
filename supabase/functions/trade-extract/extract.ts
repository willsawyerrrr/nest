/**
 * The extraction flow, with its I/O injected so the ordering and the failure
 * behaviour are unit-tested without a network, a database, or a model.
 * `index.ts` wires the real household resolution, Vault key read, Storage
 * download, and Anthropic call.
 *
 * **Extraction never writes a trade anywhere.** It returns the trades it read;
 * the client turns each into a draft the member confirms, edits, or discards,
 * and the member's own save is what persists — there is deliberately no write
 * path here, matching `deduction-extract`.
 *
 * The client uploads the document first, so the request carries the Storage
 * object path rather than bytes. A client-supplied path is not trusted: its
 * first segment must be the caller's own household, which is defence in depth
 * on top of Storage RLS. The request also carries the financial year the trades
 * are being added to, so a yearless date resolves within that year's 1 July –
 * 30 June window; a missing or malformed year is rejected.
 *
 * Every failure answers `{ code, error }`: a stable `code` the client can act
 * on and fixed copy of ours. Nothing the model API or the model said reaches
 * the client.
 */

import { type RawTradeDocument, toExtractions, type TradeExtraction } from './fields.ts'
import {
  type DocumentFile,
  maxBytesFor,
  type ModelResult,
  resolveMediaType,
  TRADE_MODEL,
} from './model.ts'

/** The private bucket the client uploads documents to, shared with deduction receipts. */
export const DOCUMENTS_BUCKET = 'receipts'

/** The stable error codes a failed extraction is reported to clients as. */
export type FailureCode =
  | 'path_required'
  | 'financial_year_required'
  | 'household_not_found'
  | 'wrong_household'
  | 'not_configured'
  | 'file_not_found'
  | 'file_empty'
  | 'unsupported_type'
  | 'file_too_large'
  | 'not_trade_document'
  | 'no_trades'
  | 'out_of_credit'
  | 'key_rejected'
  | 'timeout'
  | 'rate_limited'
  | 'unreadable'
  | 'refused'
  | 'unavailable'

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

/** An object read from the documents bucket. */
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
  /** Sends the file to the model, primed for the financial year the trades are added to. */
  extract: (file: DocumentFile, apiKey: string, financialYear: number) => Promise<ModelResult>
}

/** The successful response body. */
export interface ExtractionBody {
  /** The pinned model that read the document, so a stale client can tell. */
  model: string
  trades: TradeExtraction[]
}

const FAILURES: Record<FailureCode, { status: number; error: string }> = {
  path_required: { status: 400, error: 'A document file path is required.' },
  financial_year_required: { status: 400, error: 'A financial year is required.' },
  household_not_found: { status: 404, error: 'No household membership for this user.' },
  wrong_household: { status: 403, error: 'That file does not belong to your household.' },
  not_configured: {
    status: 503,
    error: 'Trade extraction is not configured. Enter the trades by hand.',
  },
  file_not_found: { status: 404, error: 'That document could not be found.' },
  file_empty: { status: 400, error: 'That document is empty.' },
  unsupported_type: {
    status: 415,
    error: "That file type can't be read automatically. Enter the trade by hand.",
  },
  file_too_large: { status: 413, error: 'That file is too large to read.' },
  not_trade_document: {
    status: 422,
    error: 'That file does not look like a contract note, trade confirmation, or statement.',
  },
  no_trades: { status: 422, error: 'No trades could be found in that document.' },
  out_of_credit: {
    status: 503,
    error:
      'Trade reading is off until the Anthropic account is topped up. Nothing is wrong with your file — enter the trades by hand.',
  },
  key_rejected: {
    status: 503,
    error:
      'Trade reading is off until the Anthropic API key is fixed. Nothing is wrong with your file — enter the trades by hand.',
  },
  timeout: {
    status: 504,
    error: 'Reading the document took too long. Try again, or enter the trades by hand.',
  },
  rate_limited: {
    status: 429,
    error: 'Reading documents is rate limited right now. Try again shortly.',
  },
  unreadable: { status: 502, error: 'The document could not be read. Enter the trades by hand.' },
  refused: { status: 422, error: 'That file could not be read. Enter the trades by hand.' },
  unavailable: {
    status: 502,
    error: 'The document could not be read right now. Try again, or enter the trades by hand.',
  },
}

function fail(code: FailureCode, error?: string): FlowResult {
  const failure = FAILURES[code]
  return { status: failure.status, body: { code, error: error ?? failure.error } }
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

/** Reads a raw financial year, or null when it is not a whole number. */
export function normaliseFinancialYear(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) ? raw : null
}

/** The household a bucket path belongs to: its first segment. */
export function householdSegment(path: string): string {
  return path.split('/')[0]
}

export async function runExtract(
  rawPath: unknown,
  rawFinancialYear: unknown,
  deps: ExtractDeps,
): Promise<FlowResult> {
  const path = normalisePath(rawPath)
  const financialYear = normaliseFinancialYear(rawFinancialYear)
  if (!path) return fail('path_required')
  if (financialYear === null) return fail('financial_year_required')

  const household = await deps.resolveHousehold()
  if (household.error || !household.householdId) {
    return household.error
      ? { status: household.error.status, body: { error: household.error.message } }
      : fail('household_not_found')
  }

  // Defence in depth over Storage RLS: the path is the client's, so it is checked
  // against the caller's own household before anything is read.
  if (householdSegment(path) !== household.householdId) return fail('wrong_household')

  const apiKey = await deps.apiKey()
  if (!apiKey) return fail('not_configured')

  const object = await deps.downloadObject(path)
  if (!object) return fail('file_not_found')
  if (object.bytes.length === 0) return fail('file_empty')

  const mediaType = resolveMediaType(object.contentType, path)
  if (!mediaType) return fail('unsupported_type')

  const maxBytes = maxBytesFor(mediaType)
  if (object.bytes.length > maxBytes) {
    return fail(
      'file_too_large',
      `That file is too large to read (${megabytes(object.bytes.length)} MB; the limit is ${
        megabytes(maxBytes)
      } MB).`,
    )
  }

  const result = await deps.extract({ mediaType, bytes: object.bytes }, apiKey, financialYear)
  if (!result.ok) return modelFailure(result)

  return documentOutcome(result.document)
}

function documentOutcome(document: RawTradeDocument): FlowResult {
  if (!document.is_trade_document) return fail('not_trade_document')
  if (document.trades.length === 0) return fail('no_trades')
  const body: ExtractionBody = { model: TRADE_MODEL, trades: toExtractions(document) }
  return { status: 200, body }
}

/** One decimal place, enough for a size message. */
function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/** Maps a model failure to a code the client can act on. */
function modelFailure(result: Extract<ModelResult, { ok: false }>): FlowResult {
  switch (result.failure) {
    case 'no_credit':
      return fail('out_of_credit')
    case 'key_rejected':
      return fail('key_rejected')
    case 'timeout':
      return fail('timeout')
    case 'malformed':
      return fail('unreadable')
    case 'refused':
      return fail('refused')
  }
  if (result.status === 429) return fail('rate_limited')
  // A `5xx` or a request that never landed is a bad moment worth a retry; a `4xx`
  // none of the cases above claimed is a request the API will reject identically.
  const transient = result.status === undefined || result.status >= 500
  return fail(transient ? 'unavailable' : 'unreadable')
}
