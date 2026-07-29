/**
 * The payslip fields extraction reads, and the shaping of a model response into
 * the payload the client pre-fills its manual entry form from.
 *
 * The model reports every field as the literal text printed on the slip (or
 * null); this module converts that text to the column-shaped values — money in
 * integer cents, dates as ISO — keeps the text alongside so the form can show
 * what was read, and names the fields that came back empty or unreadable. The
 * slip's own itemisation comes back the same way: each printed earnings line and
 * each printed tax line, label and amount as printed, the totals staying the
 * scalar fields they already are. Everything here is pure: nothing calls an API or
 * a database, and nothing writes a payslip.
 */

import { isPlaceholder, parseCents, parseIsoDate } from './money.ts'

/** Payslip dates the model reads, named as the `payslip` columns are. */
export const DATE_FIELDS = ['period_start', 'period_end', 'paid_on'] as const

/**
 * Payslip amounts the model reads. Each becomes a `<name>_cents` value in the
 * response, matching the `payslip` column it pre-fills.
 */
export const MONEY_FIELDS = [
  'gross',
  'tax_withheld',
  'super',
  'net',
  'salary_sacrifice',
  'ytd_gross',
  'ytd_tax_withheld',
  'ytd_super',
] as const

/**
 * The itemised lines the model reads: the slip's earnings section line by line,
 * and its tax section split into the components it prints. Each becomes an array
 * under the same name in the response.
 */
export const LINE_FIELDS = ['earnings_lines', 'tax_lines'] as const

/** The parts of the liability a tax line may pay, as an AU slip names them. */
export const TAX_COMPONENTS = ['payg', 'stsl'] as const

export type DateField = typeof DATE_FIELDS[number]
export type MoneyField = typeof MONEY_FIELDS[number]
export type LineField = typeof LINE_FIELDS[number]
export type TaxComponent = typeof TAX_COMPONENTS[number]

/** A key of the response's `fields`: a date column or a `_cents` amount column. */
export type ExtractedField = DateField | `${MoneyField}_cents`

/** One line as the model reports it: the label and amount printed on the slip. */
export interface RawPayslipLine {
  label: string
  amount: string | null
}

/** A tax line, which also names which part of the liability it pays. */
export interface RawPayslipTaxLine extends RawPayslipLine {
  component: TaxComponent | null
}

/** What the model reports: the literal text it read for each field, or null. */
export type RawPayslipFields = {
  /** False when the document is not a payslip at all. */
  is_payslip: boolean
  /** Why it is not a payslip, when `is_payslip` is false. */
  not_payslip_reason: string | null
  /** The earnings section line by line, empty when the slip itemises none. */
  earnings_lines: RawPayslipLine[]
  /** The tax section line by line, empty when the slip itemises none. */
  tax_lines: RawPayslipTaxLine[]
} & Record<DateField | MoneyField, string | null>

/**
 * One itemised line, shaped for the form's own line rows: the label as printed,
 * the amount as printed, and that amount in cents.
 *
 * `amount_cents` is **signed**, unlike the slip's own totals. Every `payslip`
 * amount column is checked `>= 0`, but `payslip_line.amount_cents` deliberately is
 * not — a line may be a negative adjustment reversing an overpayment — so a
 * negative line amount is a figure to pre-fill rather than one to discard.
 */
export interface ExtractedLine {
  label: string
  /** The amount as printed, so the form can show what was read for the line. */
  amount: string | null
  /** The printed amount in integer cents; null when it could not be converted. */
  amount_cents: number | null
}

/** An itemised tax line, carrying the component the slip says it pays. */
export interface ExtractedTaxLine extends ExtractedLine {
  component: TaxComponent | null
}

/** The shaped extraction the client pre-fills the manual entry form from. */
export interface PayslipExtraction {
  /** Column-shaped values: ISO dates and integer cents; null where unavailable. */
  fields: Record<ExtractedField, string | number | null>
  /** The literal text read for each field, so the form can show what was seen. */
  text: Record<DateField | MoneyField, string | null>
  /**
   * The slip's own itemisation, in the order it prints it. The section totals are
   * `fields` — a TOTAL row is never a line — so summing the lines and reading the
   * total never counts the same money twice.
   */
  lines: {
    earnings: ExtractedLine[]
    tax: ExtractedTaxLine[]
  }
  /** `fields` keys the slip did not show. */
  missing: ExtractedField[]
  /** `fields` keys whose text was read but could not be converted safely. */
  unreadable: ExtractedField[]
}

/** Trims a reported value to text, or null when absent, ill-typed, or a placeholder. */
function readText(raw: unknown): string | null {
  // A non-string is indistinguishable from absent on purpose: a number the model
  // computed is exactly what this feature must not trust.
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return isPlaceholder(text) ? null : text
}

/**
 * The component a tax line pays, or null when the model named neither of the two.
 * Anything unrecognised reads as null rather than as PAYG: a component guessed at
 * measures the withholding against the wrong part of the liability, and an unset
 * one is picked by the member instead.
 */
function readComponent(raw: unknown): TaxComponent | null {
  const text = readText(raw)?.toLowerCase()
  return TAX_COMPONENTS.find((component) => component === text) ?? null
}

/** A line with no label is nothing the form could show, so it is dropped. */
function readLine(item: Record<string, unknown>): RawPayslipLine | null {
  const label = readText(item.label)
  return label === null ? null : { label, amount: readText(item.amount) }
}

/** A tax line reads as an earnings line does, plus the component it pays. */
function readTaxLine(item: Record<string, unknown>): RawPayslipTaxLine | null {
  const line = readLine(item)
  return line === null ? null : { ...line, component: readComponent(item.component) }
}

/**
 * Reads the lines of one section, dropping anything that is not a usable line.
 * A slip that itemises nothing — or a model that reports null for the section —
 * yields no lines rather than an error: the totals stand on their own.
 */
function readLines<L>(raw: unknown, read: (item: Record<string, unknown>) => L | null): L[] {
  if (!Array.isArray(raw)) return []
  const lines: L[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const line = read(item as Record<string, unknown>)
    if (line !== null) lines.push(line)
  }
  return lines
}

/**
 * Reads a tool-call input into the fields, or `null` when the response is not a
 * usable extraction. Only a missing or non-boolean `is_payslip` makes it
 * unusable — every other field degrades to null, never to a guess.
 */
export function readRawFields(input: unknown): RawPayslipFields | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  if (typeof record.is_payslip !== 'boolean') return null

  const fields = {
    is_payslip: record.is_payslip,
    not_payslip_reason: readText(record.not_payslip_reason),
    earnings_lines: readLines(record.earnings_lines, readLine),
    tax_lines: readLines(record.tax_lines, readTaxLine),
  } as RawPayslipFields
  for (const name of [...DATE_FIELDS, ...MONEY_FIELDS]) {
    fields[name] = readText(record[name])
  }
  return fields
}

/** Shapes one reported line, converting its printed amount here rather than in the model. */
function toLine(line: RawPayslipLine): ExtractedLine {
  return { label: line.label, amount: line.amount, amount_cents: parseCents(line.amount) }
}

/** Shapes the model's reported text into the response payload. */
export function toExtraction(raw: RawPayslipFields): PayslipExtraction {
  const fields = {} as Record<ExtractedField, string | number | null>
  const text = {} as Record<DateField | MoneyField, string | null>
  const missing: ExtractedField[] = []
  const unreadable: ExtractedField[] = []

  const record = (key: ExtractedField, source: string | null, value: string | number | null) => {
    fields[key] = value
    if (value !== null) return
    // Text we read but could not convert is a likely misread the member should
    // see; no text at all is simply a field the slip does not show.
    if (source === null) missing.push(key)
    else unreadable.push(key)
  }

  for (const name of DATE_FIELDS) {
    text[name] = raw[name]
    record(name, raw[name], parseIsoDate(raw[name]))
  }
  for (const name of MONEY_FIELDS) {
    text[name] = raw[name]
    record(`${name}_cents`, raw[name], parseCents(raw[name]))
  }

  const lines = {
    earnings: raw.earnings_lines.map(toLine),
    tax: raw.tax_lines.map((line) => ({ ...toLine(line), component: line.component })),
  }

  return { fields, text, lines, missing, unreadable }
}
