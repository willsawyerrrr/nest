/**
 * The model call behind payslip extraction: what the model is asked for, which
 * files it accepts, and how its answer is read back.
 *
 * Structure is forced with a tool schema rather than parsed out of prose, and
 * every field in that schema is nullable, so a slip that omits super — or a
 * figure the model cannot find — comes back null instead of invented. The model
 * reports amounts as the literal text printed on the slip; `money.ts` converts
 * them. Alongside the section totals it reports each printed line the sections are
 * made up of, and for a tax line which part of the liability the slip says it
 * pays — never which projected inflow an earnings line draws on, which is the
 * household's own data and no part of what a model can see. The HTTP transport is
 * injectable, exactly as `_shared/up.ts`'s client is, so the request this builds
 * can be asserted against a stub.
 */

import Anthropic, { type APIError } from '@anthropic-ai/sdk'
import { encodeBase64 } from '@std/encoding/base64'
import {
  DATE_FIELDS,
  LINE_FIELDS,
  MONEY_FIELDS,
  type RawPayslipFields,
  readRawFields,
  TAX_COMPONENTS,
} from './fields.ts'

/**
 * The pinned model: Claude Haiku 4.5, whose dated snapshot id is the pin
 * (`claude-haiku-4-5` is the alias). Structured field extraction from a document
 * is its use case, and at a payslip a fortnight per member the spend is cents a
 * year. Every edge-function dependency in this repo is pinned for
 * reproducibility, and the model is one of them: a silent model change would
 * silently change which figures come back.
 *
 * Haiku 4.5 is on the standard vision tier — images are downscaled to a 1568px
 * long edge and 1568 visual tokens — so a large photographed slip loses detail
 * and its small print may be misread. A PDF with a text layer is unaffected:
 * each page's extracted text is provided alongside its image.
 */
export const PAYSLIP_MODEL = 'claude-haiku-4-5-20251001'

/** What the extraction accepts: a PDF, or a photo/scan of a slip. */
export const SUPPORTED_MEDIA_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type SupportedMediaType = typeof SUPPORTED_MEDIA_TYPES[number]

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
 * and a whole request may not exceed 32 MB. A payslip is a few hundred kilobytes,
 * so these only ever catch a mistake — and catching it here yields a clear
 * message instead of a truncated request.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 20 * 1024 * 1024

/** A downloaded payslip, ready to send. */
export interface PayslipFile {
  mediaType: SupportedMediaType
  bytes: Uint8Array
}

export interface ModelSuccess {
  ok: true
  fields: RawPayslipFields
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

/** Sends a payslip to the model and reports the fields it read. */
export type PayslipExtractor = (file: PayslipFile) => Promise<ModelResult>

/**
 * Resolves the media type to send, preferring what Storage recorded and falling
 * back to the object's extension (uploads routinely land as
 * `application/octet-stream`). Null for anything unsupported — a HEIC photo or a
 * spreadsheet is rejected with a clear message rather than sent and refused.
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

const SYSTEM_PROMPT = [
  'You read Australian payslips and report the figures printed on them, for a',
  'person to confirm before saving. You never save anything yourself.',
  '',
  'Report every amount as the literal text printed on the slip, character for',
  'character, including its thousands separators, decimal point, and any currency',
  'sign — never a number you have computed, converted, rounded, or reformatted.',
  '',
  'Report only what the slip shows. Never derive a figure by adding, subtracting,',
  'or annualising others, and never carry a figure over from a similar slip you',
  'have seen. If the slip does not show a field, report null for it: a null is',
  'filled in by hand, while a guess becomes a wrong tax figure nobody notices.',
  '',
  'Report dates as YYYY-MM-DD, converting the slip’s format (Australian slips',
  'write DD/MM/YYYY).',
  '',
  'Where the slip itemises a section, report each printed line as well as the',
  'section total: every line in the earnings section, and every line in the tax',
  'section, in the order the slip prints them. Never report a TOTAL or subtotal',
  'row as a line — each section’s total is its own field, so a total reported',
  'again as a line would count that money twice.',
  '',
  'If the document is not a payslip, set is_payslip to false, say why in',
  'not_payslip_reason, and report null for every field.',
].join('\n')

/** The description shown to the model for each field it reads. */
const FIELD_PROMPTS: Record<string, string> = {
  period_start: 'First day of the pay period.',
  period_end: 'Last day of the pay period.',
  paid_on: 'Date the pay was made, when the slip shows one separately.',
  gross: 'Gross pay for this pay period, as printed.',
  tax_withheld:
    'Total tax withheld for this pay period, as printed: the total of the slip’s tax section, ' +
    'which covers PAYG income tax together with any STSL (study and training support loan) ' +
    'component. Report the printed total, never one you work out from the components; where ' +
    'the slip prints a single tax figure and no total, that figure is the total.',
  super: 'Employer superannuation (the super guarantee) for this pay period, as printed.',
  net: 'Net pay for this pay period, as printed.',
  salary_sacrifice: 'Salary-sacrificed superannuation for this pay period, as printed.',
  ytd_gross: 'Year-to-date gross pay, as printed.',
  ytd_tax_withheld:
    'Year-to-date total tax withheld, as printed, on the same basis as the period figure: the ' +
    'printed year-to-date tax total, covering PAYG together with any STSL component, not the ' +
    'PAYG line alone.',
  ytd_super: 'Year-to-date superannuation, as printed.',
  earnings_lines: 'Every line printed in the earnings section — the salary, wage, leave, and ' +
    'allowance rows the gross is made up of — one entry each, in the order printed, label and ' +
    'amount as printed. Not the section’s TOTAL row, and not a line you have worked out yourself.',
  tax_lines: 'Every line printed in the tax section, one entry each, in the order printed, ' +
    'label and amount as printed, each saying which part of the tax it pays. Not the ' +
    'section’s TOTAL row.',
}

/** A nullable string property: every field is optional on a real payslip. */
function nullableString(description: string) {
  return {
    anyOf: [{ type: 'string' }, { type: 'null' }],
    description: `${description} Null when the slip does not show it.`,
  }
}

/** A line's label, the one part of a line the slip always prints. */
const LINE_LABEL = {
  type: 'string',
  description: 'The line’s description exactly as the slip prints it, e.g. “Ordinary Hours”.',
}

/** A line's amount, read as printed exactly as the section totals are. */
const LINE_AMOUNT = nullableString('The line’s amount, as printed.')

/**
 * Which part of the liability a tax line pays. Nullable on purpose: an AU slip
 * names the two plainly ("PAYG", "STSL Component"), but a line whose words do not
 * say has to come back unnamed so the member picks it, because a component guessed
 * at would measure the withholding against the wrong half of the liability.
 */
const LINE_COMPONENT = {
  anyOf: [{ type: 'string', enum: [...TAX_COMPONENTS] }, { type: 'null' }],
  description: 'Which part of the tax this line pays, in the slip’s own words: “payg” for PAYG ' +
    'income tax withholding, “stsl” for a study and training support loan component ' +
    '(STSL, HELP, HECS, or SFSS). Null when the slip does not say which of the two it ' +
    'is — an unnamed component is filled in by hand, while a guess sends the ' +
    'withholding against the wrong part of the liability.',
}

/** A nullable array of itemised lines: a slip printing no line detail reports null. */
function nullableLines(description: string, properties: Record<string, unknown>) {
  return {
    anyOf: [
      {
        type: 'array',
        items: {
          type: 'object',
          properties,
          required: Object.keys(properties),
          additionalProperties: false,
        },
      },
      { type: 'null' },
    ],
    description: `${description} Null when the slip prints no such lines.`,
  }
}

/** The tool that carries the extraction; forcing it is what makes the answer structured. */
export const PAYSLIP_TOOL: Anthropic.Tool = {
  name: 'record_payslip',
  description:
    'Report the fields read from a payslip so a person can confirm them. Amounts are the literal text printed on the slip.',
  input_schema: {
    type: 'object',
    properties: {
      is_payslip: {
        type: 'boolean',
        description: 'True when this document is a payslip; false for anything else.',
      },
      not_payslip_reason: nullableString('What the document is, when it is not a payslip.'),
      ...Object.fromEntries(
        [...DATE_FIELDS, ...MONEY_FIELDS].map((
          name,
        ) => [name, nullableString(FIELD_PROMPTS[name])]),
      ),
      earnings_lines: nullableLines(FIELD_PROMPTS.earnings_lines, {
        label: LINE_LABEL,
        amount: LINE_AMOUNT,
      }),
      tax_lines: nullableLines(FIELD_PROMPTS.tax_lines, {
        label: LINE_LABEL,
        amount: LINE_AMOUNT,
        component: LINE_COMPONENT,
      }),
    },
    required: [
      'is_payslip',
      'not_payslip_reason',
      ...DATE_FIELDS,
      ...MONEY_FIELDS,
      ...LINE_FIELDS,
    ],
    additionalProperties: false,
  },
}

/**
 * How long one extraction may take before the member is told to retry, and how
 * many attempts it gets. Extraction is interactive and the form is one tap away,
 * so a failure surfaces immediately rather than doubling the wait on a retry.
 */
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RETRIES = 0

/**
 * Room for the whole answer. The scalar figures are a couple of hundred tokens and
 * the itemised lines are the rest, so a slip printing a dozen earnings rows beside
 * its tax components still fits several times over — which matters because a tool
 * call cut off mid-object arrives as an unreadable answer rather than a short one.
 */
const MAX_OUTPUT_TOKENS = 2048

/** Builds the extractor, with the HTTP transport injectable for tests. */
export function anthropicExtractor(apiKey: string, fetchImpl?: typeof fetch): PayslipExtractor {
  const client = new Anthropic({
    apiKey,
    maxRetries: MAX_RETRIES,
    timeout: REQUEST_TIMEOUT_MS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
  return (file) => extractWithClient(client, file)
}

/** The document (or image) block for the file, placed before the instruction. */
function fileBlock(file: PayslipFile): Anthropic.ContentBlockParam {
  const data = encodeBase64(file.bytes)
  if (file.mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
  }
  return { type: 'image', source: { type: 'base64', media_type: file.mediaType, data } }
}

/** The API's own machine-readable code for a billing failure. */
const BILLING_ERROR_TYPE = 'billing_error'

/**
 * The sentence the API sends when an account's credit is exhausted: "Your credit
 * balance is too low to access the Anthropic API. Please go to Plans & Billing to
 * upgrade or purchase credits."
 */
const CREDIT_EXHAUSTED_MESSAGE = 'credit balance is too low'

/**
 * Whether an API error is the account being out of credit rather than a fault in
 * the request that was sent.
 *
 * An exhausted balance arrives as a `400` under `invalid_request_error` — the
 * same `error.type` every genuinely malformed request carries — so the message is
 * the only signal separating the two. Requiring that status *and* that type
 * *and* that one sentence is what keeps every other bad request reading as the
 * server fault it is: a malformed tool schema or an oversized document cannot
 * match. `billing_error` is checked first, being the API's own code for the same
 * class of problem wherever it sends it.
 *
 * A spend limit that arrives as a `429` is deliberately not matched. The API
 * reports it exactly as it reports a request-rate limit, with the same status and
 * the same `rate_limit_error` type, so the two cannot be told apart — and reading
 * a rate limit as an empty account would be the worse mistake, since waiting
 * fixes it.
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
 * Whether an API error is the key itself being refused rather than anything about
 * the request or the moment.
 *
 * A key that is wrong, revoked, or of the wrong kind arrives as `401`
 * `authentication_error`; a key the API accepts but will not let make this call
 * arrives as `403` `permission_error`. Both the status *and* that status's own
 * `error.type` are required, and the type is what the SDK read straight out of
 * the response body's `error.type`, so only the API's own verdict matches: a
 * `401` from a proxy or gateway in front of the API carries no Anthropic error
 * body and therefore no type, and stays the generic upstream failure it is.
 * Nothing else can slip in either, because no other status is looked at — a
 * `500`, a `429`, or a `400` is never a refused key.
 *
 * Checked after {@linkcode outOfCredit}, which claims `billing_error` at any
 * status: a `403` over billing is an account to top up, not a key to rotate.
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
  file: PayslipFile,
): Promise<ModelResult> {
  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: PAYSLIP_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [PAYSLIP_TOOL],
      // Forcing the tool is what guarantees a structured answer rather than prose.
      tool_choice: { type: 'tool', name: PAYSLIP_TOOL.name },
      messages: [{
        role: 'user',
        content: [fileBlock(file), {
          type: 'text',
          text: 'Read this payslip and record its fields.',
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
