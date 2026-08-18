import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DeductionExtraction } from '../lib/deductionExtraction'
import {
  useDeductionFields,
  type DeductionFieldValues,
  type PrefillSummary,
} from './useDeductionFields'

const blank: DeductionFieldValues = {
  description: '',
  amount: '',
  deductionDate: '2026-08-01',
}

function extraction(overrides: Partial<DeductionExtraction['fields']> = {}): DeductionExtraction {
  return {
    model: 'claude-haiku-4-5-20251001',
    fields: {
      description: 'Officeworks',
      deduction_date: '2026-08-05',
      amount_cents: 124_50,
      ...overrides,
    },
  }
}

/** Runs a pre-fill inside `act` and hands back what it reported doing. */
function prefill(
  result: { current: ReturnType<typeof useDeductionFields> },
  value = extraction(),
): PrefillSummary {
  let summary!: PrefillSummary
  act(() => {
    summary = result.current.prefill(value)
  })
  return summary
}

describe('useDeductionFields', () => {
  it('fills every field the receipt reported, the amount as dollars', () => {
    const { result } = renderHook(() => useDeductionFields(blank))

    const summary = prefill(result)

    expect(result.current.values).toEqual({
      description: 'Officeworks',
      amount: 124.5,
      deductionDate: '2026-08-05',
    })
    expect(summary.filledNothing).toBe(false)
  })

  it('leaves a field the receipt does not show, rather than blanking it', () => {
    const { result } = renderHook(() => useDeductionFields({ ...blank, description: 'My label' }))

    prefill(result, extraction({ description: null }))

    expect(result.current.values.description).toBe('My label')
  })

  it('keeps a value the member typed rather than counting it as filled', () => {
    const { result } = renderHook(() => useDeductionFields(blank))

    act(() => result.current.setAmount(500))
    const summary = prefill(result)

    expect(result.current.values.amount).toBe(500)
    // The fields around the typed one are still filled.
    expect(result.current.values.description).toBe('Officeworks')
    expect(summary.filledNothing).toBe(false)
  })

  it('records a cleared date as the member’s own, not an empty slot to fill', () => {
    const { result } = renderHook(() => useDeductionFields(blank))

    act(() => result.current.setDeductionDate(null))
    prefill(result)

    expect(result.current.values.deductionDate).toBeNull()
  })

  it('says plainly when a read filled in nothing', () => {
    const { result } = renderHook(() => useDeductionFields(blank))

    const summary = prefill(result, { model: 'x', fields: {} })

    expect(summary.filledNothing).toBe(true)
    expect(result.current.values).toEqual(blank)
  })

  it('keeps a value typed while the read was still running', () => {
    const { result } = renderHook(() => useDeductionFields(blank))

    // One batch: the typing has not reached `values` by the time the read
    // lands, exactly as it has not when the pre-fill runs after an await.
    let summary!: PrefillSummary
    act(() => {
      result.current.setDescription('My label')
      summary = result.current.prefill(extraction({ description: 'Officeworks' }))
    })

    expect(result.current.values.description).toBe('My label')
    expect(result.current.values.amount).toBe(124.5)
    expect(summary.filledNothing).toBe(false)
  })
})
