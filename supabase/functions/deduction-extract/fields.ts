/**
 * The receipt fields extraction reads, and the shaping of a model response into
 * the payload the client pre-fills its add-deduction form from.
 *
 * The model reports the amount as the literal text printed on the receipt (or
 * null); this module converts that text to the column-shaped values — cents and
 * an ISO date — keeps the amount's text alongside so the form can show what was
 * read, and names the fields that came back empty or unreadable. The
 * description needs no conversion: what the model reports is what the form
 * fills in. Everything here is pure: nothing calls an API or a database, and
 * nothing writes a deduction.
 */

import { isPlaceholder, parseCents, parseIsoDate } from '../_shared/money.ts'

/** Receipt dates the model reads, named as the `deduction` column is. */
export const DATE_FIELDS = ['deduction_date'] as const

/** Receipt amounts the model reads. Becomes `amount_cents` in the response. */
export const MONEY_FIELDS = ['amount'] as const

export type DateField = (typeof DATE_FIELDS)[number]
export type MoneyField = (typeof MONEY_FIELDS)[number]

/** A key of the response's `fields`: the description, the date, or the amount in cents. */
export type ExtractedField = DateField | `${MoneyField}_cents` | 'description'

/** What the model reports: the literal text it read for each field, or null. */
export type RawDeductionFields = {
  /** False when the document is not a receipt at all. */
  is_receipt: boolean
  /** Why it is not a receipt, when `is_receipt` is false. */
  not_receipt_reason: string | null
  /** The merchant/business name, or — absent one — what was purchased, as printed. */
  description: string | null
} & Record<DateField | MoneyField, string | null>

/** The shaped extraction the client pre-fills the add-deduction form from. */
export interface DeductionExtraction {
  /** Column-shaped values: an ISO date, integer cents, and the description text. */
  fields: Record<ExtractedField, string | number | null>
  /** The literal text read for the date and amount, so the form can show what was seen. */
  text: Record<DateField | MoneyField, string | null>
  /** `fields` keys the receipt did not show. */
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
 * usable extraction. Only a missing or non-boolean `is_receipt` makes it
 * unusable — every other field degrades to null, never to a guess.
 */
export function readRawFields(input: unknown): RawDeductionFields | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  if (typeof record.is_receipt !== 'boolean') return null

  const fields = {
    is_receipt: record.is_receipt,
    not_receipt_reason: readText(record.not_receipt_reason),
    description: readText(record.description),
  } as RawDeductionFields
  for (const name of [...DATE_FIELDS, ...MONEY_FIELDS]) {
    fields[name] = readText(record[name])
  }
  return fields
}

/** Shapes the model's reported text into the response payload. */
export function toExtraction(raw: RawDeductionFields): DeductionExtraction {
  const fields = {} as Record<ExtractedField, string | number | null>
  const text = {} as Record<DateField | MoneyField, string | null>
  const missing: ExtractedField[] = []
  const unreadable: ExtractedField[] = []

  const record = (key: ExtractedField, source: string | null, value: string | number | null) => {
    fields[key] = value
    if (value !== null) return
    // Text we read but could not convert is a likely misread the member should
    // see; no text at all is simply a field the receipt does not show.
    if (source === null) missing.push(key)
    else unreadable.push(key)
  }

  // The description needs no conversion: its value is the text itself.
  record('description', raw.description, raw.description)

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
