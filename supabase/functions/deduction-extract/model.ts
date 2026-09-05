/**
 * The model call behind receipt extraction: what the model is asked for, which
 * files it accepts, and how its answer is read back.
 *
 * Structure is forced with a tool schema rather than parsed out of prose, and
 * every field in that schema is nullable, so a receipt that does not show a
 * field — or one the model cannot find — comes back null instead of invented.
 * The model reports the amount as the literal text printed on the receipt;
 * `fields.ts` converts it. The HTTP transport is injectable, exactly as
 * `payslip-extract/model.ts`'s client is, so the request this builds can be
 * asserted against a stub.
 */

import Anthropic, { type APIError } from '@anthropic-ai/sdk'
import { encodeBase64 } from '@std/encoding/base64'
import { type RawDeductionFields, readRawFields } from './fields.ts'

/**
 * The pinned model: Claude Haiku 4.5, whose dated snapshot id is the pin
 * (`claude-haiku-4-5` is the alias). Structured field extraction from a
 * document is its use case, and at a receipt a deduction the spend is cents a
 * year. Every edge-function dependency in this repo is pinned for
 * reproducibility, and the model is one of them: a silent model change would
 * silently change which figures come back.
 */
export const DEDUCTION_MODEL = 'claude-haiku-4-5-20251001'

/** What the extraction accepts: a PDF, or a photo/scan of a receipt. */
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
 * Per-kind size caps, both derived from Messages API limits with headroom for
 * base64's 4/3 inflation: a single image may not exceed 10 MB base64-encoded,
 * and a whole request may not exceed 32 MB. A receipt is a few hundred
 * kilobytes, so these only ever catch a mistake — and catching it here yields a
 * clear message instead of a truncated request.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 20 * 1024 * 1024

/** A downloaded receipt, ready to send. */
export interface ReceiptFile {
  mediaType: SupportedMediaType
  bytes: Uint8Array
}

export interface ModelSuccess {
  ok: true
  fields: RawDeductionFields
}

export interface ModelFailure {
  ok: false
  /**
   * Why the call yielded no fields: the account being out of credit, the key
   * being refused, any other model-API failure, the model declining, or an
   * unusable answer. `no_credit` and `key_rejected` are their own cases because
   * they are the ones an operator has to fix — every other failure is the file,
   * the answer, or a bad moment.
   */
  failure: 'no_credit' | 'key_rejected' | 'api_error' | 'timeout' | 'refused' | 'malformed'
  message: string
  /** The upstream HTTP status, when the API returned one. */
  status?: number
}

export type ModelResult = ModelSuccess | ModelFailure

/**
 * Sends a receipt to the model and reports the fields it read. `category`
 * defaults to `work_expense`, the default `deduction.category`.
 */
export type ReceiptExtractor = (
  file: ReceiptFile,
  category?: DeductionCategory,
) => Promise<ModelResult>

/**
 * Resolves the media type to send, preferring what Storage recorded and
 * falling back to the object's extension (uploads routinely land as
 * `application/octet-stream`). Null for anything unsupported — a HEIC photo or
 * a spreadsheet is rejected with a clear message rather than sent and refused.
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

/**
 * A deduction's kind, mirroring the `deduction.category` column: `work_expense`
 * (the default), `donation`, or `tax_agent_fees`. Personal deductible super
 * contributions are never a deduction category — they are entered on the Super
 * tab as `super_contribution.kind = 'personal_deductible'` — so extraction is
 * never asked to read one.
 */
export type DeductionCategory = 'work_expense' | 'donation' | 'tax_agent_fees'

/** What each category expects the model to read a document as. */
interface CategoryExpectation {
  /** Named in the rejection instruction and the `is_receipt` tool description. */
  documentKind: string
  /** What the description field should be read as, for this kind of document. */
  descriptionGuidance: string
  descriptionPrompt: string
}

const CATEGORY_EXPECTATIONS: Record<DeductionCategory, CategoryExpectation> = {
  work_expense: {
    documentKind: 'a receipt or invoice for a purchase',
    descriptionGuidance:
      'Report the description as the merchant or business name printed on the receipt. Where no business name is printed, report what was purchased instead, in a few words.',
    descriptionPrompt:
      'The merchant/business name as printed, or — absent one — what was purchased.',
  },
  donation: {
    documentKind: 'a donation tax receipt from a deductible gift recipient (DGR)',
    descriptionGuidance:
      'Report the description as the charity or deductible gift recipient (DGR) name printed on the receipt.',
    descriptionPrompt: 'The charity or DGR name as printed on the receipt.',
  },
  tax_agent_fees: {
    documentKind: 'an invoice for tax agent or accountant fees',
    descriptionGuidance:
      'Report the description as the tax agent or accounting firm name printed on the invoice.',
    descriptionPrompt: 'The tax agent or accounting firm name as printed on the invoice.',
  },
}

function buildSystemPrompt(category: DeductionCategory): string {
  const { documentKind, descriptionGuidance } = CATEGORY_EXPECTATIONS[category]
  return [
    'You read receipts for tax-deductible expenses and report the figures printed',
    'on them, for a person to confirm before saving. You never save anything',
    'yourself.',
    '',
    'Report the amount as the literal text printed on the receipt, character for',
    'character, including its thousands separators, decimal point, and any',
    'currency sign — never a number you have computed, converted, rounded, or',
    'reformatted. Report the TOTAL amount paid, never a subtotal, a GST or other',
    'tax line, or a single line item where the receipt lists several.',
    '',
    descriptionGuidance,
    '',
    'Report the date as YYYY-MM-DD, converting the receipt’s own format',
    '(Australian receipts write DD/MM/YYYY). Where a receipt prints more than one',
    'date, report the date of purchase or transaction, never a statement or due',
    'date.',
    '',
    'If the receipt does not show a field, report null for it: a null is filled',
    'in by hand, while a guess becomes a wrong deduction nobody notices. Never',
    'derive a figure by adding, subtracting, or estimating from others, and never',
    'carry a figure over from a similar receipt you have seen.',
    '',
    `If the document is not ${documentKind}, set is_receipt to`,
    'false, say why in not_receipt_reason, and report null for every field.',
  ].join('\n')
}

/** The description shown to the model for the date and amount fields, the same for every category. */
const FIELD_PROMPTS = {
  deduction_date: 'The date of purchase, as printed.',
  amount: 'The total amount paid, as printed.',
}

/** A nullable string property: every field is optional on a real receipt. */
function nullableString(description: string) {
  return {
    anyOf: [{ type: 'string' }, { type: 'null' }],
    description: `${description} Null when the receipt does not show it.`,
  }
}

/** The tool that carries the extraction, tailored to what a document of this category should look like. */
export function buildReceiptTool(category: DeductionCategory): Anthropic.Tool {
  const { documentKind, descriptionPrompt } = CATEGORY_EXPECTATIONS[category]
  return {
    name: 'record_receipt',
    description:
      'Report the fields read from a receipt so a person can confirm them. The amount is the literal text printed on the receipt.',
    input_schema: {
      type: 'object',
      properties: {
        is_receipt: {
          type: 'boolean',
          description: `True when this document is ${documentKind}; false for anything else.`,
        },
        not_receipt_reason: nullableString('What the document is, when it is not a receipt.'),
        description: nullableString(descriptionPrompt),
        deduction_date: nullableString(FIELD_PROMPTS.deduction_date),
        amount: nullableString(FIELD_PROMPTS.amount),
      },
      required: ['is_receipt', 'not_receipt_reason', 'description', 'deduction_date', 'amount'],
      additionalProperties: false,
    },
  }
}

/** The `work_expense` tool schema — a receipt or invoice for a purchase, the default category. */
export const RECEIPT_TOOL: Anthropic.Tool = buildReceiptTool('work_expense')

/**
 * How long one extraction may take before the member is told to retry, and how
 * many attempts it gets. Extraction is interactive and the form is one tap
 * away, so a failure surfaces immediately rather than doubling the wait on a
 * retry.
 */
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RETRIES = 0

/**
 * Room for the whole answer. A receipt's fields are a few dozen tokens at most,
 * so this is generous headroom against a tool call cut off mid-object, which
 * arrives as an unreadable answer rather than a short one.
 */
const MAX_OUTPUT_TOKENS = 512

/** Builds the extractor, with the HTTP transport injectable for tests. */
export function anthropicExtractor(apiKey: string, fetchImpl?: typeof fetch): ReceiptExtractor {
  const client = new Anthropic({
    apiKey,
    maxRetries: MAX_RETRIES,
    timeout: REQUEST_TIMEOUT_MS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
  return (file, category = 'work_expense') => extractWithClient(client, file, category)
}

/** The document (or image) block for the file, placed before the instruction. */
function fileBlock(file: ReceiptFile): Anthropic.ContentBlockParam {
  const data = encodeBase64(file.bytes)
  if (file.mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
  }
  return { type: 'image', source: { type: 'base64', media_type: file.mediaType, data } }
}

/** The API's own machine-readable code for a billing failure. */
const BILLING_ERROR_TYPE = 'billing_error'

/**
 * The sentence the API sends when an account's credit is exhausted: "Your
 * credit balance is too low to access the Anthropic API. Please go to Plans &
 * Billing to upgrade or purchase credits."
 */
const CREDIT_EXHAUSTED_MESSAGE = 'credit balance is too low'

/**
 * Whether an API error is the account being out of credit rather than a fault
 * in the request that was sent. See `payslip-extract/model.ts`'s identical
 * classifier for the full reasoning; this mirrors it exactly for the same
 * Anthropic error shapes.
 */
function outOfCredit(error: APIError): boolean {
  if (error.type === BILLING_ERROR_TYPE) return true
  if (error.status !== 400 || error.type !== 'invalid_request_error') return false
  const body = error.error as { error?: { message?: unknown } } | undefined
  const message = body?.error?.message
  return typeof message === 'string' &&
    message.toLowerCase().includes(CREDIT_EXHAUSTED_MESSAGE)
}

/**
 * Whether an API error is the key itself being refused rather than anything
 * about the request or the moment. See `payslip-extract/model.ts`'s identical
 * classifier for the full reasoning.
 */
function keyRejected(error: APIError): boolean {
  if (error.status === 401) return error.type === 'authentication_error'
  if (error.status === 403) return error.type === 'permission_error'
  return false
}

/** Which operator-shaped failure an API error is, if it is one at all. */
function apiFailure(error: APIError): ModelFailure['failure'] {
  if (outOfCredit(error)) return 'no_credit'
  if (keyRejected(error)) return 'key_rejected'
  return 'api_error'
}

async function extractWithClient(
  client: Anthropic,
  file: ReceiptFile,
  category: DeductionCategory,
): Promise<ModelResult> {
  const tool = buildReceiptTool(category)
  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: DEDUCTION_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: buildSystemPrompt(category),
      tools: [tool],
      // Forcing the tool is what guarantees a structured answer rather than prose.
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{
        role: 'user',
        content: [fileBlock(file), {
          type: 'text',
          text: 'Read this receipt and record its fields.',
        }],
      }],
    })
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return { ok: false, failure: 'timeout', message: 'The model did not answer in time.' }
    }
    if (error instanceof Anthropic.APIError) {
      return {
        ok: false,
        failure: apiFailure(error),
        message: error.message,
        ...(typeof error.status === 'number' ? { status: error.status } : {}),
      }
    }
    return {
      ok: false,
      failure: 'api_error',
      message: error instanceof Error ? error.message : 'Could not reach the model.',
    }
  }

  // A refusal is a successful HTTP response with no content, so it is checked
  // before the tool call is looked for.
  if (message.stop_reason === 'refusal') {
    return { ok: false, failure: 'refused', message: 'The model declined to read that file.' }
  }

  const toolUse = message.content.find((block) => block.type === 'tool_use')
  if (!toolUse) {
    return { ok: false, failure: 'malformed', message: 'The model returned no extraction.' }
  }
  const fields = readRawFields(toolUse.input)
  if (!fields) {
    return { ok: false, failure: 'malformed', message: 'The model returned unreadable fields.' }
  }
  return { ok: true, fields }
}
