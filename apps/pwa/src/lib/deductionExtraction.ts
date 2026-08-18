/**
 * The client half of receipt extraction: the shape the `deduction-extract`
 * edge function answers with, and the reading of its failures into states the
 * add-deduction form can show honestly.
 *
 * Nothing here writes a deduction. Extraction only ever pre-fills the
 * add-deduction form — the member confirms every value and their own save is
 * what persists — so a failure at any point leaves manual entry exactly as it
 * was.
 */

/** The `deduction` columns extraction reads, keyed as the columns are. */
export const EXTRACTED_FIELDS = ['description', 'deduction_date', 'amount_cents'] as const

export type ExtractedField = (typeof EXTRACTED_FIELDS)[number]

/**
 * A successful read, as the form pre-fills from it. `fields` is column-shaped —
 * an ISO date and integer cents, converted server-side in TypeScript rather
 * than by the model — carrying only the values there is something to fill in
 * for; a field the receipt does not show, or one whose printed text could not
 * be converted safely, is absent and left blank for the member.
 */
export interface DeductionExtraction {
  model: string
  fields: Partial<Record<ExtractedField, string | number | null>>
}

/**
 * How an attach-and-read ended. Every outcome but `read` falls back to manual
 * entry with the reason stated; none of them blocks the save.
 */
export type ExtractionOutcome =
  | { status: 'read'; extraction: DeductionExtraction }
  | { status: 'not-configured'; message: string }
  | { status: 'out-of-credit'; message: string }
  | { status: 'key-rejected'; message: string }
  | { status: 'not-receipt'; message: string; reason: string | null }
  | { status: 'failed'; message: string }

/** Every outcome but a successful read: the form falls back to manual entry. */
export type ExtractionFailure = Exclude<ExtractionOutcome, { status: 'read' }>

/** What the form says when the operator has not set the extraction API key. */
export const EXTRACTION_UNCONFIGURED_MESSAGE =
  'Receipt extraction is not configured. Enter the details by hand.'

/**
 * What the form says when the account paying for extraction has run out of
 * credit. Reading is off until an operator tops it up, so the note says whose
 * fault it is not and points at hand entry rather than at a retry that cannot
 * work.
 */
export const EXTRACTION_OUT_OF_CREDIT_MESSAGE =
  'Receipt reading is off until the Anthropic account is topped up. Nothing is wrong with your file — enter the details by hand.'

/**
 * What the form says when the API refuses the key extraction is configured
 * with — wrong, revoked, or not permitted to make the call.
 */
export const EXTRACTION_KEY_REJECTED_MESSAGE =
  'Receipt reading is off until the Anthropic API key is fixed. Nothing is wrong with your file — enter the details by hand.'

/** What the form says when the model reports the file is not a receipt. */
export const NOT_RECEIPT_MESSAGE = 'That file does not look like a receipt.'

/** What the form says when a failure carried no message of its own. */
export const EXTRACTION_FAILED_MESSAGE = 'Could not read this receipt. Enter the details by hand.'

/** Whether `value` is a plain object whose keys can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Reads a successful reply into the extraction the form pre-fills from, or null
 * when the body is not one. The body comes from the household's own edge
 * function, but it is still read rather than trusted: a shape the form cannot
 * render is a failure it can state plainly instead of a crash mid-render.
 */
export function readExtraction(body: unknown): DeductionExtraction | null {
  if (!isRecord(body) || typeof body.model !== 'string') {
    return null
  }
  const raw = isRecord(body.fields) ? body.fields : {}

  const fields: DeductionExtraction['fields'] = {}
  if (typeof raw.description === 'string') {
    fields.description = raw.description
  }
  if (typeof raw.deduction_date === 'string') {
    fields.deduction_date = raw.deduction_date
  }
  if (typeof raw.amount_cents === 'number' && raw.amount_cents >= 0) {
    fields.amount_cents = raw.amount_cents
  }

  return { model: body.model, fields }
}

/**
 * Messages the function sends about its own internals rather than about the
 * member's file. They describe a broken deployment and offer nothing to act
 * on, so the plain fallback stands in.
 */
const INTERNAL_MESSAGES: ReadonlySet<string> = new Set([
  'No household membership for this user',
  'Could not resolve household',
])

/**
 * Reads a non-2xx body into the state the form shows. The function's own
 * message is preferred wherever it sent one, because it is the specific one,
 * and a plain fallback stands in when the body carried none (a gateway or
 * network failure that never reached the function) or when the one it carried
 * is about the function's own internals.
 */
export function readExtractionFailure(body: unknown): ExtractionFailure {
  const detail = body as
    | {
        error?: unknown
        configured?: unknown
        outOfCredit?: unknown
        keyRejected?: unknown
        notReceipt?: unknown
        reason?: unknown
      }
    | null
    | undefined
  const message =
    typeof detail?.error === 'string' && !INTERNAL_MESSAGES.has(detail.error) ? detail.error : null

  if (detail?.configured === false) {
    return { status: 'not-configured', message: message ?? EXTRACTION_UNCONFIGURED_MESSAGE }
  }
  if (detail?.outOfCredit === true) {
    return { status: 'out-of-credit', message: message ?? EXTRACTION_OUT_OF_CREDIT_MESSAGE }
  }
  if (detail?.keyRejected === true) {
    return { status: 'key-rejected', message: message ?? EXTRACTION_KEY_REJECTED_MESSAGE }
  }
  if (detail?.notReceipt === true) {
    return {
      status: 'not-receipt',
      message: message ?? NOT_RECEIPT_MESSAGE,
      reason: typeof detail.reason === 'string' ? detail.reason : null,
    }
  }
  return { status: 'failed', message: message ?? EXTRACTION_FAILED_MESSAGE }
}
