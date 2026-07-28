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

/** What a pre-fill did, so the form can say which figures came off the slip. */
export interface PrefillSummary {
  /** Fields the extraction filled in. */
  filled: ExtractedField[]
  /** Fields left exactly as the member had already set them. */
  kept: ExtractedField[]
}

export interface PayslipFields {
  values: PayslipFieldValues
  setDate: (field: ExtractedDateField, value: string | null) => void
  setAmount: (field: ExtractedAmountField, value: number | string) => void
  /**
   * Writes an extraction over the fields the member has not edited and reports
   * which those were.
   */
  prefill: (extraction: PayslipExtraction) => PrefillSummary
}

/**
 * Holds the payslip form's pre-fillable fields and remembers which of them the
 * member has edited.
 *
 * Extraction is a convenience, not an authority: it fills a field only while the
 * member has left it alone, so a figure they typed is never quietly replaced by
 * one a model read. Edited-ness is tracked rather than emptiness because the
 * form opens with a pay period already defaulted — a default is the form's
 * guess and may be overwritten, a typed value is the member's and may not.
 */
export function usePayslipFields(initial: PayslipFieldValues): PayslipFields {
  const [values, setValues] = useState(initial)
  const [edited, setEdited] = useState<ReadonlySet<ExtractedField>>(() => new Set())

  const record = useCallback((field: ExtractedField, value: string | number | null) => {
    setValues((current) => ({ ...current, [field]: value }))
    setEdited((current) => new Set(current).add(field))
  }, [])

  const setDate = useCallback(
    (field: ExtractedDateField, value: string | null) => record(field, value),
    [record],
  )

  const setAmount = useCallback(
    (field: ExtractedAmountField, value: number | string) => record(field, value),
    [record],
  )

  const prefill = useCallback(
    (extraction: PayslipExtraction): PrefillSummary => {
      const filled: ExtractedField[] = []
      const kept: ExtractedField[] = []
      const next: PayslipFieldValues = { ...values }

      /** Whether the field is the extraction's to write, recording either way. */
      const claim = (field: ExtractedField): boolean => {
        if (edited.has(field)) {
          kept.push(field)
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
          next[field] = read
        }
      }
      for (const field of EXTRACTED_AMOUNT_FIELDS) {
        const read = extraction.fields[field]
        if (typeof read === 'number' && claim(field)) {
          next[field] = centsToDollars(read)
        }
      }

      setValues(next)
      return { filled, kept }
    },
    [values, edited],
  )

  return { values, setDate, setAmount, prefill }
}
