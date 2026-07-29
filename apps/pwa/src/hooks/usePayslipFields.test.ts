import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PayslipExtraction } from '../lib/payslipExtraction'
import { usePayslipFields, type PayslipFieldValues, type PrefillSummary } from './usePayslipFields'

const blank: PayslipFieldValues = {
  period_start: '2026-07-01',
  period_end: '2026-07-14',
  paid_on: null,
  gross_cents: '',
  tax_withheld_cents: '',
  super_cents: '',
  net_cents: '',
  salary_sacrifice_cents: '',
  ytd_gross_cents: '',
  ytd_tax_withheld_cents: '',
  ytd_super_cents: '',
}

function extraction(overrides: Partial<PayslipExtraction> = {}): PayslipExtraction {
  return {
    model: 'claude-haiku-4-5-20251001',
    fields: {
      period_start: '2026-07-06',
      period_end: '2026-07-19',
      paid_on: '2026-07-22',
      gross_cents: 4_120_50,
      tax_withheld_cents: 1_048_00,
      super_cents: 473_86,
      net_cents: 3_072_50,
      salary_sacrifice_cents: null,
      ytd_gross_cents: null,
      ytd_tax_withheld_cents: null,
      ytd_super_cents: null,
    },
    text: { gross: '4,120.50' },
    lines: { earnings: [], tax: [] },
    missing: ['salary_sacrifice_cents'],
    unreadable: [],
    ...overrides,
  }
}

/** Runs a pre-fill inside `act` and hands back what it reported doing. */
function prefill(
  result: { current: ReturnType<typeof usePayslipFields> },
  value = extraction(),
): PrefillSummary {
  let summary!: PrefillSummary
  act(() => {
    summary = result.current.prefill(value)
  })
  return summary
}

describe('usePayslipFields', () => {
  it('fills every field the slip reported, amounts as dollars', () => {
    const { result } = renderHook(() => usePayslipFields(blank))

    const summary = prefill(result)

    expect(result.current.values).toMatchObject({
      period_start: '2026-07-06',
      period_end: '2026-07-19',
      paid_on: '2026-07-22',
      gross_cents: 4_120.5,
      tax_withheld_cents: 1_048,
      super_cents: 473.86,
      net_cents: 3_072.5,
    })
    expect(summary.filled).toContain('gross_cents')
    expect(summary.kept).toEqual([])
  })

  it('leaves a field the slip does not show, rather than blanking it', () => {
    const { result } = renderHook(() => usePayslipFields({ ...blank, salary_sacrifice_cents: 50 }))

    const summary = prefill(result)

    expect(result.current.values.salary_sacrifice_cents).toBe(50)
    expect(summary.filled).not.toContain('salary_sacrifice_cents')
    expect(summary.kept).not.toContain('salary_sacrifice_cents')
  })

  it('keeps a figure the member typed and says so', () => {
    const { result } = renderHook(() => usePayslipFields(blank))

    act(() => result.current.setAmount('gross_cents', 5_000))
    act(() => result.current.setDate('period_end', '2026-06-30'))
    const summary = prefill(result)

    expect(result.current.values.gross_cents).toBe(5_000)
    expect(result.current.values.period_end).toBe('2026-06-30')
    expect(summary.kept).toEqual(['period_end', 'gross_cents'])
    expect(summary.filled).not.toContain('gross_cents')
    // The fields around the typed one are still filled.
    expect(result.current.values.net_cents).toBe(3_072.5)
  })

  it('records a cleared date as the member’s own, not an empty slot to fill', () => {
    const { result } = renderHook(() => usePayslipFields(blank))

    act(() => result.current.setDate('paid_on', null))
    const summary = prefill(result)

    expect(result.current.values.paid_on).toBeNull()
    expect(summary.kept).toEqual(['paid_on'])
  })

  it('keeps a figure typed while the read was still running', () => {
    const { result } = renderHook(() => usePayslipFields(blank))

    // One batch: the typing has not reached `values` by the time the read
    // lands, exactly as it has not when the pre-fill runs after an await.
    let summary!: PrefillSummary
    act(() => {
      result.current.setAmount('net_cents', 3_072.5)
      summary = result.current.prefill(extraction({ fields: { gross_cents: 4_120_50 } }))
    })

    expect(result.current.values.net_cents).toBe(3_072.5)
    expect(result.current.values.gross_cents).toBe(4_120.5)
    expect(summary.kept).toEqual([])
  })

  it('treats every figure a saved payslip holds as the member’s own', () => {
    const saved = {
      ...blank,
      paid_on: '2026-07-15',
      gross_cents: 5_000,
      tax_withheld_cents: 1_000,
      super_cents: 600,
      net_cents: 4_000,
    }
    const { result } = renderHook(() => usePayslipFields(saved, true))

    const summary = prefill(result)

    expect(result.current.values).toMatchObject(saved)
    expect(summary.filled).toEqual([])
    expect(summary.kept).toEqual([
      'period_start',
      'period_end',
      'paid_on',
      'gross_cents',
      'tax_withheld_cents',
      'super_cents',
      'net_cents',
    ])
  })

  it('still fills the gaps a saved payslip left blank', () => {
    const { result } = renderHook(() => usePayslipFields({ ...blank, gross_cents: 5_000 }, true))

    const summary = prefill(
      result,
      extraction({ fields: { gross_cents: 4_120_50, net_cents: 3_072_50, paid_on: '2026-07-22' } }),
    )

    expect(result.current.values.gross_cents).toBe(5_000)
    expect(result.current.values.net_cents).toBe(3_072.5)
    expect(result.current.values.paid_on).toBe('2026-07-22')
    expect(summary.filled).toEqual(['paid_on', 'net_cents'])
  })
})
