/**
 * The client half of payslip extraction: the shape the `payslip-extract` edge
 * function answers with, the reading of its failures into states the entry form
 * can show honestly, and the attribution of an itemised earnings line to the
 * inflow its printed label names — which is the client's own job, the household's
 * inflows being nothing the model can see.
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

/** The parts of the liability a tax line pays, as the slip states them. */
export const EXTRACTED_TAX_COMPONENTS = ['payg', 'stsl'] as const

export type ExtractedTaxComponent = (typeof EXTRACTED_TAX_COMPONENTS)[number]

/**
 * One line read off the slip, ready for a line row in the form: the label as
 * printed, and the printed amount in cents.
 *
 * `amount_cents` is **signed**, unlike every scalar figure here.
 * `payslip_line.amount_cents` carries no `>= 0` check — a line may be a negative
 * adjustment reversing an overpayment — so a negative line amount pre-fills as
 * printed, where a negative total is left for the member to type.
 */
export interface ExtractedLine {
  label: string
  /** Null when the printed amount could not be converted, so the line is left out. */
  amount_cents: number | null
}

/** A tax line, carrying the component the slip says it pays, or null when it does not. */
export interface ExtractedTaxLine extends ExtractedLine {
  component: ExtractedTaxComponent | null
}

/**
 * A successful read, as the form pre-fills from it. `fields` is column-shaped —
 * ISO dates and integer cents, converted server-side in TypeScript rather than by
 * the model — carrying only the figures there is something to fill in for; a field
 * the slip does not show, or one whose printed text could not be converted safely,
 * is absent and left blank for the member. `lines` is the slip's own itemisation in
 * printed order, the section totals staying in `fields` so nothing is counted twice.
 *
 * The function's reply says more than this — the literal text read for each figure,
 * and which fields were missing against which were unreadable — and that reply is
 * the auditable record of what was read. The form does not restate any of it: every
 * figure it fills is visible in the field it filled, so what the member checks
 * against the document is the form itself.
 */
export interface PayslipExtraction {
  model: string
  fields: Partial<Record<ExtractedField, string | number | null>>
  lines: {
    earnings: ExtractedLine[]
    tax: ExtractedTaxLine[]
  }
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

/** Whether `value` is a plain object whose keys can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Reads one itemised line, or null when it is not one the form could show. A line
 * needs a label to be a row at all; an amount that did not convert leaves
 * `amount_cents` null, which leaves the line out of the itemisation rather than
 * filling in a row half-way.
 */
function readLine(raw: Record<string, unknown>): ExtractedLine | null {
  if (typeof raw.label !== 'string' || raw.label.trim() === '') {
    return null
  }
  return {
    label: raw.label,
    // Cents are integers by construction; anything else is not a figure to fill in.
    amount_cents: Number.isInteger(raw.amount_cents) ? (raw.amount_cents as number) : null,
  }
}

/**
 * Reads one tax line. An unrecognised component reads as null, never as `payg`:
 * the two pay different parts of the liability, so an unnamed one is left for the
 * member to pick rather than defaulted into the more common of the two.
 */
function readTaxLine(raw: Record<string, unknown>): ExtractedTaxLine | null {
  const line = readLine(raw)
  if (line === null) {
    return null
  }
  return {
    ...line,
    component: EXTRACTED_TAX_COMPONENTS.find((component) => component === raw.component) ?? null,
  }
}

/** Reads a reported section's lines, dropping anything that is not a usable line. */
function readLines<L>(raw: unknown, read: (item: Record<string, unknown>) => L | null): L[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const lines: L[] = []
  for (const item of raw) {
    const line = isRecord(item) ? read(item) : null
    if (line !== null) {
      lines.push(line)
    }
  }
  return lines
}

/**
 * Collapses a printed label or an inflow name to the form the two are compared in:
 * case folded, with surrounding and repeated whitespace gone.
 */
function normaliseLabel(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The inflow an earnings line's printed label names, or null when nothing names it
 * exactly once.
 *
 * The model is never asked which inflow a line draws on — the household's inflows
 * are not on the slip and are no part of what it can see — so attribution is this
 * one deterministic rule instead: the whole label must equal one inflow's whole
 * name, ignoring case and whitespace. A partial, prefix, or fuzzy match is never
 * taken, and neither is a label two inflows answer to, because a line attributed to
 * the wrong inflow moves the measured variance of both without saying so. Anything
 * short of a single exact match leaves the line's inflow unset for the member.
 */
export function matchInflowByLabel(
  label: string,
  options: readonly { value: string; label: string }[],
): string | null {
  const wanted = normaliseLabel(label)
  if (wanted === '') {
    return null
  }
  const matched = options.filter((option) => normaliseLabel(option.label) === wanted)
  return matched.length === 1 ? matched[0]!.value : null
}

/**
 * Reads a successful reply into the extraction the form pre-fills from, or null
 * when the body is not one. The body comes from the household's own edge
 * function, but it is still read rather than trusted: a shape the form cannot
 * render is a failure it can state plainly instead of a crash mid-render.
 *
 * A **negative** total is dropped on the way through. The function parses the
 * accounting negatives payroll systems print — `(1,234.56)`, `45.00-` — so a slip
 * listing tax withheld as a deduction reads as a negative, and every `payslip`
 * amount column is checked `>= 0`, which would reject the save behind a generic
 * failure. The sign is not guessed at either way: the field is left blank, exactly
 * as one that could not be converted is, for the member to type from the document.
 *
 * A negative **line** amount is kept exactly as read. `payslip_line.amount_cents`
 * carries no such check, deliberately, so a line reversing an overpayment is a
 * figure to fill in rather than one to drop.
 */
export function readExtraction(body: unknown): PayslipExtraction | null {
  if (!isRecord(body) || typeof body.model !== 'string') {
    return null
  }
  const raw = isRecord(body.fields) ? body.fields : {}

  const fields: PayslipExtraction['fields'] = {}
  for (const field of EXTRACTED_DATE_FIELDS) {
    const value = raw[field]
    if (typeof value === 'string') {
      fields[field] = value
    }
  }
  for (const field of EXTRACTED_AMOUNT_FIELDS) {
    const value = raw[field]
    if (typeof value === 'number' && value >= 0) {
      fields[field] = value
    }
  }

  const rawLines = isRecord(body.lines) ? body.lines : {}

  return {
    model: body.model,
    fields,
    lines: {
      earnings: readLines(rawLines.earnings, readLine),
      tax: readLines(rawLines.tax, readTaxLine),
    },
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
