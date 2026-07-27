/**
 * The payslip fields extraction reads, and the shaping of a model response into
 * the payload the client pre-fills its manual entry form from.
 *
 * The model reports every field as the literal text printed on the slip (or
 * null); this module converts that text to the column-shaped values — money in
 * integer cents, dates as ISO — keeps the text alongside so the form can show
 * what was read, and names the fields that came back empty or unreadable. Both
 * are pure: nothing here calls an API or a database, and nothing here writes a
 * payslip.
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

export type DateField = typeof DATE_FIELDS[number]
export type MoneyField = typeof MONEY_FIELDS[number]

/** A key of the response's `fields`: a date column or a `_cents` amount column. */
export type ExtractedField = DateField | `${MoneyField}_cents`

/** What the model reports: the literal text it read for each field, or null. */
export type RawPayslipFields = {
  /** False when the document is not a payslip at all. */
  is_payslip: boolean
  /** Why it is not a payslip, when `is_payslip` is false. */
  not_payslip_reason: string | null
} & Record<DateField | MoneyField, string | null>

/** The shaped extraction the client pre-fills the manual entry form from. */
export interface PayslipExtraction {
  /** Column-shaped values: ISO dates and integer cents; null where unavailable. */
  fields: Record<ExtractedField, string | number | null>
  /** The literal text read for each field, so the form can show what was seen. */
  text: Record<DateField | MoneyField, string | null>
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
  } as RawPayslipFields
  for (const name of [...DATE_FIELDS, ...MONEY_FIELDS]) {
    fields[name] = readText(record[name])
  }
  return fields
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

  return { fields, text, missing, unreadable }
}
