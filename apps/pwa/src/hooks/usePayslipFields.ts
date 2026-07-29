import { useCallback, useState } from 'react'
import { centsToDollars } from '../lib/money'
import {
  EXTRACTED_AMOUNT_FIELDS,
  EXTRACTED_DATE_FIELDS,
  type ExtractedAmountField,
  type ExtractedDateField,
  type ExtractedField,
  type PayslipExtraction,
} from '../lib/payslipExtraction'

/**
 * The payslip form's pre-fillable fields: dates as ISO strings, amounts as the
 * dollars a `MoneyInput` holds (`''` when blank), keyed as the `payslip` columns
 * are so an extraction maps onto them by name.
 */
export type PayslipFieldValues = Record<ExtractedDateField, string | null> &
  Record<ExtractedAmountField, number | string>

/** What a pre-fill did, so the form can say whether a read gave it anything. */
export interface PrefillSummary {
  /** Fields the extraction filled in. */
  filled: ExtractedField[]
}

export interface PayslipFields {
  values: PayslipFieldValues
  setDate: (field: ExtractedDateField, value: string | null) => void
  setAmount: (field: ExtractedAmountField, value: number | string) => void
  /**
   * Writes an extraction over the fields the member has not made their own and
   * reports which those were.
   */
  prefill: (extraction: PayslipExtraction) => PrefillSummary
}

/**
 * Writes one field, keeping every other value as it stands. Generic in the field
 * so each key carries its own value type: a date cannot be written into an
 * amount slot, which a computed key alone would let through.
 */
function written<F extends ExtractedField>(
  values: PayslipFieldValues,
  field: F,
  value: PayslipFieldValues[F],
): PayslipFieldValues {
  return { ...values, [field]: value }
}

/**
 * The fields of a saved payslip that already hold the member's own figure. A
 * blank amount and an unset date are gaps a read may fill; everything else was
 * confirmed and saved once already.
 */
function savedFields(values: PayslipFieldValues): Set<ExtractedField> {
  const saved = new Set<ExtractedField>()
  for (const field of EXTRACTED_DATE_FIELDS) {
    if (values[field] !== null) {
      saved.add(field)
    }
  }
  for (const field of EXTRACTED_AMOUNT_FIELDS) {
    if (values[field] !== '') {
      saved.add(field)
    }
  }
  return saved
}

/**
 * Holds the payslip form's pre-fillable fields and remembers which of them are
 * the member's own.
 *
 * Extraction is a convenience, not an authority: it fills a field only while the
 * member has left it alone, so a figure they typed is never quietly replaced by
 * one a model read. Two kinds of value count as theirs. One they have edited in
 * this form, tracked rather than inferring it from emptiness because the form
 * opens with a pay period already defaulted — a default is the form's guess and
 * may be overwritten, a typed value is the member's and may not. And, when
 * `saved` says these values came off a payslip that already exists, every figure
 * that row holds: they confirmed each one when they saved it, so attaching a
 * replacement document reads the slip without rewriting what they filed.
 *
 * That set of fields is one mutable instance rather than a value replaced on each
 * change: nothing renders from it, and a pre-fill landing after an awaited read
 * has to see every field claimed while the read was in flight — as `values`
 * itself does, being written through an updater rather than over the snapshot the
 * read started from.
 */
export function usePayslipFields(initial: PayslipFieldValues, saved = false): PayslipFields {
  const [values, setValues] = useState(initial)
  const [claimed] = useState(() => (saved ? savedFields(initial) : new Set<ExtractedField>()))

  const setDate = useCallback(
    (field: ExtractedDateField, value: string | null) => {
      setValues((current) => written(current, field, value))
      claimed.add(field)
    },
    [claimed],
  )

  const setAmount = useCallback(
    (field: ExtractedAmountField, value: number | string) => {
      setValues((current) => written(current, field, value))
      claimed.add(field)
    },
    [claimed],
  )

  const prefill = useCallback(
    (extraction: PayslipExtraction): PrefillSummary => {
      const filled: ExtractedField[] = []
      const writes: ((values: PayslipFieldValues) => PayslipFieldValues)[] = []

      /** Whether the field is the extraction's to write, recording it where it is. */
      const claim = (field: ExtractedField): boolean => {
        if (claimed.has(field)) {
          return false
        }
        filled.push(field)
        return true
      }

      for (const field of EXTRACTED_DATE_FIELDS) {
        // A field the slip does not show, or one that could not be converted
        // safely, comes back null and is left for the member to fill.
        const read = extraction.fields[field]
        if (typeof read === 'string' && claim(field)) {
          writes.push((current) => written(current, field, read))
        }
      }
      for (const field of EXTRACTED_AMOUNT_FIELDS) {
        const read = extraction.fields[field]
        if (typeof read === 'number' && claim(field)) {
          writes.push((current) => written(current, field, centsToDollars(read)))
        }
      }

      // Written through an updater, not over a snapshot: a read takes seconds,
      // and whatever was typed while it ran belongs to a later render's values.
      setValues((current) => writes.reduce((next, write) => write(next), current))
      return { filled }
    },
    [claimed],
  )

  return { values, setDate, setAmount, prefill }
}
