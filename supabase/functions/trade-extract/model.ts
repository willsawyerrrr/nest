/**
 * The model call behind trade extraction: what the model is asked for, which
 * files it accepts, and how its answer is read back.
 *
 * Structure is forced with a tool schema rather than parsed out of prose, and
 * every field of every trade is nullable, so a document that does not show a
 * field comes back null instead of invented. The model reports each figure as
 * the literal text printed on the document; `fields.ts` converts it. The HTTP
 * transport is injectable, as in `deduction-extract/model.ts`, so the request
 * this builds can be asserted against a stub.
 */

import Anthropic, { type APIError } from '@anthropic-ai/sdk'
import { financialYearBounds } from '@nest/tax'
import { encodeBase64 } from '@std/encoding/base64'
import { type RawTradeDocument, readRawFields } from './fields.ts'

/**
 * The pinned model: Claude Haiku 4.5, whose dated snapshot id is the pin. Every
 * edge-function dependency in this repo is pinned for reproducibility, and the
 * model is one of them: a silent model change would silently change which
 * figures come back.
 */
export const TRADE_MODEL = 'claude-haiku-4-5-20251001'

/** What the extraction accepts: a PDF, or a photo/scan of a document. */
export const SUPPORTED_MEDIA_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number]

/** Extensions to fall back on when Storage reports no usable content type. */
const EXTENSION_MEDIA_TYPES: Record<string, SupportedMediaType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/**
 * Per-kind size caps, derived from Messages API limits (10 MB base64 per image,
 * 32 MB per request) with headroom for base64's 4/3 inflation.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 20 * 1024 * 1024

/** A downloaded document, ready to send. */
export interface DocumentFile {
  mediaType: SupportedMediaType
  bytes: Uint8Array
}

export interface ModelSuccess {
  ok: true
  document: RawTradeDocument
}

export interface ModelFailure {
  ok: false
  /**
   * Why the call yielded no trades: the account being out of credit, the key
   * being refused, any other model-API failure, the model declining, or an
   * unusable answer. `no_credit` and `key_rejected` are the ones an operator has
   * to fix. `message` is fixed wording of our own, never the upstream's.
   */
  failure: 'no_credit' | 'key_rejected' | 'api_error' | 'timeout' | 'refused' | 'malformed'
  message: string
  /** The upstream HTTP status, when the API returned one. */
  status?: number
}

export type ModelResult = ModelSuccess | ModelFailure

/**
 * Sends a document to the model and reports the trades it read. `financialYear`
 * is the financial year the trades are being added to, so a yearless date
 * resolves within it.
 */
export type TradeExtractor = (file: DocumentFile, financialYear: number) => Promise<ModelResult>

/**
 * Resolves the media type to send, preferring what Storage recorded and falling
 * back to the object's extension. Null for anything unsupported.
 */
export function resolveMediaType(
  contentType: string | null | undefined,
  path: string,
): SupportedMediaType | null {
  const declared = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if ((SUPPORTED_MEDIA_TYPES as readonly string[]).includes(declared)) {
    return declared as SupportedMediaType
  }
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_MEDIA_TYPES[extension] ?? null
}

/** The size cap for a media type. */
export function maxBytesFor(mediaType: SupportedMediaType): number {
  return mediaType === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
}

/** The inclusive UTC bounds of `financialYear`, as `YYYY-MM-DD` strings. */
function financialYearWindow(financialYear: number): { start: string; end: string } {
  const { start, end } = financialYearBounds(financialYear)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export function buildSystemPrompt(financialYear: number): string {
  const { start, end } = financialYearWindow(financialYear)
  return [
    'You read broker contract notes, trade confirmations, and account statements',
    'and report each share or ETF trade on them, for a person to confirm before',
    'saving. You never save anything yourself.',
    '',
    'Report one entry per trade. A statement may list several; a contract note',
    'usually lists one. Report only buys and sells of listed shares and ETFs —',
    'never dividends, distributions, transfers, deposits, fees on their own, or',
    'cash movements.',
    '',
    'Report units, price per unit, and brokerage fee as the literal text printed',
    'on the document, character for character, including its thousands',
    'separators and decimal point — never a number you have computed, converted,',
    'rounded, or reformatted. Report the price per unit, never the trade total.',
    'Report the brokerage as the fee charged for that trade, excluding GST where',
    'the document shows it separately. Report the ticker as the code alone',
    '(VAS, not VAS.AX or Vanguard Australian Shares Index ETF). Report the side',
    'as buy or sell.',
    '',
    'Report each trade’s date as YYYY-MM-DD, converting the document’s own format',
    '(Australian documents write DD/MM/YYYY). Report the date the trade was',
    'executed, never the settlement, statement, or due date.',
    '',
    `These trades are being added to the financial year running from ${start} to`,
    `${end} (1 July to 30 June). Where a date is printed without a year, report`,
    'the date that falls within this window rather than any other year.',
    '',
    'If the document does not show a field, report null for it: a null is filled',
    'in by hand, while a guess becomes a wrong trade nobody notices. Never derive',
    'a figure by adding, subtracting, dividing, or estimating from others, and',
    'never carry a figure over from a similar document you have seen.',
    '',
    'If the document is not a contract note, trade confirmation, or statement',
    'listing trades, set is_trade_document to false and report no trades.',
  ].join('\n')
}

/** A nullable string property: every field is optional on a real document. */
function nullableString(description: string) {
  return {
    anyOf: [{ type: 'string' }, { type: 'null' }],
    description: `${description} Null when the document does not show it.`,
  }
}

/** The tool that carries the extraction. */
export const TRADES_TOOL: Anthropic.Tool = {
  name: 'record_trades',
  description:
    'Report the share and ETF trades read from a document so a person can confirm them. Units, price, and fee are the literal text printed on the document.',
  input_schema: {
    type: 'object',
    properties: {
      is_trade_document: {
        type: 'boolean',
        description:
          'True when this document is a broker contract note, trade confirmation, or statement listing trades; false for anything else.',
      },
      trades: {
        type: 'array',
        description: 'One entry per buy or sell on the document; empty when there are none.',
        items: {
          type: 'object',
          properties: {
            ticker: nullableString('The ticker code alone, such as VAS.'),
            side: nullableString('Whether the trade was a buy or a sell.'),
            trade_date: nullableString('The trade date as YYYY-MM-DD.'),
            units: nullableString('The units traded, as printed.'),
            price_per_unit: nullableString('The price per unit, as printed.'),
            brokerage_fee: nullableString('The brokerage fee charged for the trade, as printed.'),
          },
          required: ['ticker', 'side', 'trade_date', 'units', 'price_per_unit', 'brokerage_fee'],
          additionalProperties: false,
        },
      },
    },
    required: ['is_trade_document', 'trades'],
    additionalProperties: false,
  },
}

/**
 * How long one extraction may take before the member is told to retry, and how
 * many attempts it gets. Extraction is interactive, so a failure surfaces
 * immediately rather than doubling the wait on a retry.
 */
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RETRIES = 0

/**
 * Room for the whole answer: about 80 tokens per trade at `MAX_TRADES`, with
 * headroom. A tool call cut off mid-array is rejected as unreadable rather than
 * read as a shorter statement.
 */
const MAX_OUTPUT_TOKENS = 12_288

/** Builds the extractor, with the HTTP transport injectable for tests. */
export function anthropicExtractor(apiKey: string, fetchImpl?: typeof fetch): TradeExtractor {
  const client = new Anthropic({
    apiKey,
    maxRetries: MAX_RETRIES,
    timeout: REQUEST_TIMEOUT_MS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
  return (file, financialYear) => extractWithClient(client, file, financialYear)
}

/** The document (or image) block for the file, placed before the instruction. */
function fileBlock(file: DocumentFile): Anthropic.ContentBlockParam {
  const data = encodeBase64(file.bytes)
  if (file.mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
  }
  return { type: 'image', source: { type: 'base64', media_type: file.mediaType, data } }
}

/** Whether an API error is the account being out of credit (see `deduction-extract/model.ts`). */
function outOfCredit(error: APIError): boolean {
  if (error.type === 'billing_error') return true
  if (error.status !== 400 || error.type !== 'invalid_request_error') return false
  const body = error.error as { error?: { message?: unknown } } | undefined
  const message = body?.error?.message
  return typeof message === 'string' && message.toLowerCase().includes('credit balance is too low')
}

/** Whether an API error is the key itself being refused (see `deduction-extract/model.ts`). */
function keyRejected(error: APIError): boolean {
  if (error.status === 401) return error.type === 'authentication_error'
  if (error.status === 403) return error.type === 'permission_error'
  return false
}

function apiFailure(error: APIError): ModelFailure['failure'] {
  if (outOfCredit(error)) return 'no_credit'
  if (keyRejected(error)) return 'key_rejected'
  return 'api_error'
}

async function extractWithClient(
  client: Anthropic,
  file: DocumentFile,
  financialYear: number,
): Promise<ModelResult> {
  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: TRADE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: buildSystemPrompt(financialYear),
      tools: [TRADES_TOOL],
      // Forcing the tool is what guarantees a structured answer rather than prose.
      tool_choice: { type: 'tool', name: TRADES_TOOL.name },
      messages: [{
        role: 'user',
        content: [fileBlock(file), {
          type: 'text',
          text: 'Read this document and record its trades.',
        }],
      }],
    })
  } catch (error) {
    // The upstream detail is logged and goes no further: a failure's `message` is
    // our own fixed wording, so nothing the API said can reach a client.
    console.error('Anthropic request failed:', error)
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return { ok: false, failure: 'timeout', message: 'The model did not answer in time.' }
    }
    if (error instanceof Anthropic.APIError) {
      return {
        ok: false,
        failure: apiFailure(error),
        message: 'The model API returned an error.',
        ...(typeof error.status === 'number' ? { status: error.status } : {}),
      }
    }
    return { ok: false, failure: 'api_error', message: 'Could not reach the model.' }
  }

  // A refusal is a successful HTTP response with no content, so it is checked
  // before the tool call is looked for.
  if (message.stop_reason === 'refusal') {
    return { ok: false, failure: 'refused', message: 'The model declined to read that file.' }
  }
  // A cut-off call would read as a shorter list of trades, silently dropping the rest.
  if (message.stop_reason === 'max_tokens') {
    return { ok: false, failure: 'malformed', message: 'The model’s answer was cut short.' }
  }

  const toolUse = message.content.find((block) => block.type === 'tool_use')
  if (!toolUse) {
    return { ok: false, failure: 'malformed', message: 'The model returned no extraction.' }
  }
  const document = readRawFields(toolUse.input)
  if (!document) {
    return { ok: false, failure: 'malformed', message: 'The model returned unreadable fields.' }
  }
  return { ok: true, document }
}
