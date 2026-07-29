/**
 * The client half of payslip extraction: the shape the `payslip-extract` edge
 * function answers with, and the reading of its failures into states the entry
 * form can show honestly.
 *
 * Nothing here writes a payslip figure. Extraction only ever pre-fills the
 * manual entry form — the member confirms every value and their own save is what
 * persists — so a failure at any point leaves manual entry exactly as it was.
 */

/** The `payslip` date columns extraction reads, keyed as the columns are. */
export const EXTRACTED_DATE_FIELDS = ['period_start', 'period_end', 'paid_on'] as const

/**
 * The payslip amounts extraction reads, named as the slip prints them. Each one
 * is both a `<name>_cents` column and a `text` key, so the column names and the
 * text keys are derived from this single list rather than restated beside it —
 * a name that drifts out of step with its label or its key is a type error.
 */
export const EXTRACTED_MONEY_FIELDS = [
  'gross',
  'tax_withheld',
  'super',
  'net',
  'salary_sacrifice',
  'ytd_gross',
  'ytd_tax_withheld',
  'ytd_super',
] as const

export type ExtractedDateField = (typeof EXTRACTED_DATE_FIELDS)[number]
export type ExtractedMoneyField = (typeof EXTRACTED_MONEY_FIELDS)[number]
/** The `payslip` amount columns extraction reads, in integer cents. */
export type ExtractedAmountField = `${ExtractedMoneyField}_cents`
export type ExtractedField = ExtractedDateField | ExtractedAmountField
/** A `text` key: a date column, or an amount column without its `_cents` suffix. */
export type ExtractedTextKey = ExtractedDateField | ExtractedMoneyField

export const EXTRACTED_AMOUNT_FIELDS: readonly ExtractedAmountField[] = EXTRACTED_MONEY_FIELDS.map(
  (field) => `${field}_cents` as const,
)

/** Every key the literal text read off a slip is reported under. */
export const EXTRACTED_TEXT_KEYS: readonly ExtractedTextKey[] = [
  ...EXTRACTED_DATE_FIELDS,
  ...EXTRACTED_MONEY_FIELDS,
]

/** How each extracted field is named back to the member, matching its form label. */
export const EXTRACTED_FIELD_LABELS: Record<ExtractedField, string> = {
  period_start: 'Period start',
  period_end: 'Period end',
  paid_on: 'Paid on',
  gross_cents: 'Gross',
  tax_withheld_cents: 'Tax withheld',
  super_cents: 'Super',
  net_cents: 'Net',
  salary_sacrifice_cents: 'Salary sacrifice',
  ytd_gross_cents: 'YTD gross',
  ytd_tax_withheld_cents: 'YTD tax withheld',
  ytd_super_cents: 'YTD super',
}

/**
 * A successful read. `fields` is column-shaped — ISO dates and integer cents,
 * converted server-side in TypeScript rather than by the model — and `text` is
 * the literal text printed on the slip, so the form can show what was seen and
 * the member can spot a misread rather than confirming one blind. `missing`
 * names fields the slip does not show and `unreadable` those whose text came
 * back but could not be converted safely; both are `fields` keys.
 */
export interface PayslipExtraction {
  model: string
  fields: Partial<Record<ExtractedField, string | number | null>>
  text: Partial<Record<ExtractedTextKey, string | null>>
  missing: ExtractedField[]
  unreadable: ExtractedField[]
}

/**
 * How an attach-and-read ended. Every outcome but `read` falls back to manual
 * entry with the reason stated; none of them blocks the save.
 */
export type ExtractionOutcome =
  | { status: 'read'; extraction: PayslipExtraction }
  | { status: 'not-configured'; message: string }
  | { status: 'out-of-credit'; message: string }
  | { status: 'key-rejected'; message: string }
  | { status: 'not-payslip'; message: string; reason: string | null }
  | { status: 'failed'; message: string }

/** Every outcome but a successful read: the form falls back to manual entry. */
export type ExtractionFailure = Exclude<ExtractionOutcome, { status: 'read' }>

/** What the form says when the operator has not set the extraction API key. */
export const EXTRACTION_UNCONFIGURED_MESSAGE =
  'Payslip extraction is not configured. Enter the figures by hand.'

/**
 * What the form says when the account paying for extraction has run out of
 * credit. Reading is off until an operator tops it up, so the note says whose
 * fault it is not and points at hand entry rather than at a retry that cannot
 * work.
 */
export const EXTRACTION_OUT_OF_CREDIT_MESSAGE =
  'Payslip reading is off until the Anthropic account is topped up. Nothing is wrong with your file — enter the figures by hand.'

/**
 * What the form says when the API refuses the key extraction is configured with —
 * wrong, revoked, or not permitted to make the call. Reading is off until an
 * operator rotates it, so the note reads as the out-of-credit one does: whose
 * fault it is not, and hand entry rather than a retry the same key would fail.
 */
export const EXTRACTION_KEY_REJECTED_MESSAGE =
  'Payslip reading is off until the Anthropic API key is fixed. Nothing is wrong with your file — enter the figures by hand.'

/** What the form says when the model reports the file is not a payslip. */
export const NOT_PAYSLIP_MESSAGE = 'That file does not look like a payslip.'

/** What the form says when a failure carried no message of its own. */
export const EXTRACTION_FAILED_MESSAGE = 'Could not read this payslip. Enter the figures by hand.'

/** The suffix an amount column carries over the name printed on the slip. */
const CENTS_SUFFIX = '_cents'

/** The `text` key for a field: an amount's column name without its `_cents` suffix. */
export function extractedTextKey(field: ExtractedField): ExtractedTextKey {
  return field.endsWith(CENTS_SUFFIX)
    ? (field.slice(0, -CENTS_SUFFIX.length) as ExtractedMoneyField)
    : (field as ExtractedDateField)
}

/** Whether `value` names a field the form can pre-fill. */
function isExtractedField(value: unknown): value is ExtractedField {
  return typeof value === 'string' && value in EXTRACTED_FIELD_LABELS
}

/** Whether `value` is a plain object whose keys can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Reads a successful reply into the extraction the form pre-fills from, or null
 * when the body is not one. The body comes from the household's own edge
 * function, but it is still read rather than trusted: a shape the form cannot
 * render is a failure it can state plainly instead of a crash mid-render.
 *
 * A **negative** amount is moved to `unreadable` on the way through. The
 * function parses the accounting negatives payroll systems print — `(1,234.56)`,
 * `45.00-` — so a slip listing tax withheld as a deduction reads as a negative,
 * and every `payslip` amount column is checked `>= 0`, which would reject the
 * save behind a generic failure. The sign is not guessed at either way: the
 * field reads exactly as one that could not be converted safely, its printed
 * text shown so the member types the figure themselves.
 */
export function readExtraction(body: unknown): PayslipExtraction | null {
  if (!isRecord(body) || typeof body.model !== 'string') {
    return null
  }
  const raw = isRecord(body.fields) ? body.fields : {}
  const rawText = isRecord(body.text) ? body.text : {}

  const fields: PayslipExtraction['fields'] = {}
  const unreadable = Array.isArray(body.unreadable) ? body.unreadable.filter(isExtractedField) : []
  for (const field of EXTRACTED_DATE_FIELDS) {
    const value = raw[field]
    if (typeof value === 'string') {
      fields[field] = value
    }
  }
  for (const field of EXTRACTED_AMOUNT_FIELDS) {
    const value = raw[field]
    if (typeof value !== 'number') {
      continue
    }
    if (value < 0) {
      unreadable.push(field)
    } else {
      fields[field] = value
    }
  }

  const text: PayslipExtraction['text'] = {}
  for (const key of EXTRACTED_TEXT_KEYS) {
    const value = rawText[key]
    if (typeof value === 'string') {
      text[key] = value
    }
  }

  return {
    model: body.model,
    fields,
    text,
    missing: Array.isArray(body.missing) ? body.missing.filter(isExtractedField) : [],
    unreadable,
  }
}

/**
 * Messages the function sends about its own internals rather than about the
 * member's file. They describe a broken deployment, name concepts the member has
 * no view of, and offer nothing to act on, so the plain fallback stands in.
 */
const INTERNAL_MESSAGES: ReadonlySet<string> = new Set([
  'No household membership for this user',
  'Could not resolve household',
])

/**
 * Reads a non-2xx body into the state the form shows. The function's own message
 * is preferred wherever it sent one, because it is the specific one — the file's
 * size against the limit, the types it takes, how long to back off — and a plain
 * fallback stands in when the body carried none (a gateway or network failure
 * that never reached the function) or when the one it carried is about the
 * function's own internals.
 *
 * The outcomes the form treats differently are picked out by their own flags:
 * `configured: false`, `outOfCredit: true`, and `keyRejected: true` are all the
 * feature being off rather than broken — kept apart because the fix differs, a
 * key to set against an account to top up against a key to rotate — and
 * `notPayslip` is the model saying so rather than hallucinating a slip.
 */
export function readExtractionFailure(body: unknown): ExtractionFailure {
  const detail = body as
    | {
        error?: unknown
        configured?: unknown
        outOfCredit?: unknown
        keyRejected?: unknown
        notPayslip?: unknown
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
  if (detail?.notPayslip === true) {
    return {
      status: 'not-payslip',
      message: message ?? NOT_PAYSLIP_MESSAGE,
      reason: typeof detail.reason === 'string' ? detail.reason : null,
    }
  }
  return { status: 'failed', message: message ?? EXTRACTION_FAILED_MESSAGE }
}
