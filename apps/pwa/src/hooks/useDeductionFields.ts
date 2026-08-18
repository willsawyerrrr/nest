import { useCallback, useState } from 'react'
import type { DeductionExtraction } from '../lib/deductionExtraction'
import { centsToDollars } from '../lib/money'

/** The add-deduction form's pre-fillable fields, keyed as the `deduction` columns are. */
export interface DeductionFieldValues {
  description: string
  amount: number | string
  deductionDate: string | null
}

/** What a pre-fill did, so the form can say whether a read gave it anything. */
export interface PrefillSummary {
  /** Whether the read filled in anything at all. */
  filledNothing: boolean
}

export interface DeductionFields {
  values: DeductionFieldValues
  setDescription: (value: string) => void
  setAmount: (value: number | string) => void
  setDeductionDate: (value: string | null) => void
  /**
   * Writes an extraction over the fields the member has not made their own —
   * typed here already — and reports whether it filled in anything.
   */
  prefill: (extraction: DeductionExtraction) => PrefillSummary
}

/**
 * Holds the add-deduction form's pre-fillable fields and remembers which of
 * them are the member's own.
 *
 * Extraction is a convenience, not an authority: it fills a field only while
 * the member has left it alone, tracked as each setter is called, so a value
 * they typed is never quietly replaced by one a model read. Only the ADD form
 * uses this — editing an existing deduction carries no attachment mechanics —
 * so there is no saved-row case to seed the claimed set from, unlike
 * `usePayslipFields`.
 */
export function useDeductionFields(initial: DeductionFieldValues): DeductionFields {
  const [values, setValues] = useState(initial)
  const [claimed] = useState(() => new Set<keyof DeductionFieldValues>())

  const setDescription = useCallback(
    (value: string) => {
      setValues((current) => ({ ...current, description: value }))
      claimed.add('description')
    },
    [claimed],
  )

  const setAmount = useCallback(
    (value: number | string) => {
      setValues((current) => ({ ...current, amount: value }))
      claimed.add('amount')
    },
    [claimed],
  )

  const setDeductionDate = useCallback(
    (value: string | null) => {
      setValues((current) => ({ ...current, deductionDate: value }))
      claimed.add('deductionDate')
    },
    [claimed],
  )

  const prefill = useCallback(
    (extraction: DeductionExtraction): PrefillSummary => {
      // What to write is decided here, outside the updater below, so the
      // updater itself stays a pure function of `current` — safe to invoke more
      // than once, as React strict-mode double-invocation does.
      const writes: ((values: DeductionFieldValues) => DeductionFieldValues)[] = []

      const description = extraction.fields.description
      if (typeof description === 'string' && !claimed.has('description')) {
        writes.push((current) => ({ ...current, description }))
      }
      const amountCents = extraction.fields.amount_cents
      if (typeof amountCents === 'number' && !claimed.has('amount')) {
        const amount = centsToDollars(amountCents)
        writes.push((current) => ({ ...current, amount }))
      }
      const deductionDate = extraction.fields.deduction_date
      if (typeof deductionDate === 'string' && !claimed.has('deductionDate')) {
        writes.push((current) => ({ ...current, deductionDate }))
      }

      // Written through an updater, not over a snapshot: a read takes seconds,
      // and whatever was typed while it ran belongs to a later render's values.
      setValues((current) => writes.reduce((next, write) => write(next), current))
      return { filledNothing: writes.length === 0 }
    },
    [claimed],
  )

  return { values, setDescription, setAmount, setDeductionDate, prefill }
}
