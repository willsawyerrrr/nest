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

/** The `payslip` amount columns extraction reads, in integer cents. */
export const EXTRACTED_AMOUNT_FIELDS = [
  'gross_cents',
  'tax_withheld_cents',
  'super_cents',
  'net_cents',
  'salary_sacrifice_cents',
  'ytd_gross_cents',
  'ytd_tax_withheld_cents',
  'ytd_super_cents',
] as const

export type ExtractedDateField = (typeof EXTRACTED_DATE_FIELDS)[number]
export type ExtractedAmountField = (typeof EXTRACTED_AMOUNT_FIELDS)[number]
export type ExtractedField = ExtractedDateField | ExtractedAmountField

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
  text: Partial<Record<string, string | null>>
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
  | { status: 'not-payslip'; message: string; reason: string | null }
  | { status: 'failed'; message: string }

/** Every outcome but a successful read: the form falls back to manual entry. */
export type ExtractionFailure = Exclude<ExtractionOutcome, { status: 'read' }>

/** What the form says when the operator has not set the extraction API key. */
export const EXTRACTION_UNCONFIGURED_MESSAGE =
  'Payslip extraction is not configured. Enter the figures by hand.'

/** What the form says when the model reports the file is not a payslip. */
export const NOT_PAYSLIP_MESSAGE = 'That file does not look like a payslip.'

/** What the form says when a failure carried no message of its own. */
export const EXTRACTION_FAILED_MESSAGE = 'Could not read this payslip. Enter the figures by hand.'

/** The `text` key for a field: an amount's column name without its `_cents` suffix. */
export function extractedTextKey(field: ExtractedField): string {
  const suffix = '_cents'
  return field.endsWith(suffix) ? field.slice(0, -suffix.length) : field
}

/**
 * Reads a non-2xx body into the state the form shows. The function's own message
 * is preferred wherever it sent one, because it is the specific one — the file's
 * size against the limit, the types it takes, how long to back off — and a plain
 * fallback stands in when the body carried none (a gateway or network failure
 * that never reached the function).
 *
 * The two outcomes the form treats differently are picked out by their own
 * flags: `configured: false` is the feature being off rather than broken, and
 * `notPayslip` is the model saying so rather than hallucinating a slip.
 */
export function readExtractionFailure(body: unknown): ExtractionFailure {
  const detail = body as
    | { error?: unknown; configured?: unknown; notPayslip?: unknown; reason?: unknown }
    | null
    | undefined
  const message = typeof detail?.error === 'string' ? detail.error : null

  if (detail?.configured === false) {
    return { status: 'not-configured', message: message ?? EXTRACTION_UNCONFIGURED_MESSAGE }
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
