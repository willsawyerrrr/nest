import { describe, expect, it } from 'vitest'
import { summarise } from '@nest/plan'
import { applyBreakdownAmounts } from './derivedBudget'
import type { BudgetLine } from '../hooks/useBudgetLines'

function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: 'l1',
    household_id: 'h',
    line_group: 'wants',
    name: 'Line',
    amount_cents: 10_00,
    frequency: 'monthly',
    interval_weeks: null,
    goal_id: null,
    destination_account_id: null,
    breakdown_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('applyBreakdownAmounts', () => {
  it('replaces a derived line with its breakdown’s annual total', () => {
    const lines = [line({ id: 'd', breakdown_id: 'b1', amount_cents: 0, frequency: 'monthly' })]
    const result = applyBreakdownAmounts(lines, new Map([['b1', 150_00]]))
    expect(result[0]!.amount_cents).toBe(150_00)
    expect(result[0]!.frequency).toBe('annual')
  })

  it('falls back to zero when the breakdown is absent from the map', () => {
    const lines = [line({ id: 'd', breakdown_id: 'b1', amount_cents: 42_00 })]
    const result = applyBreakdownAmounts(lines, new Map())
    expect(result[0]!.amount_cents).toBe(0)
  })

  it('leaves manual lines untouched', () => {
    const manual = line({ id: 'm', amount_cents: 42_00, frequency: 'weekly' })
    const derived = line({ id: 'd', breakdown_id: 'b1', amount_cents: 0 })
    const result = applyBreakdownAmounts([manual, derived], new Map([['b1', 30_00]]))
    expect(result[0]).toEqual(manual)
    expect(result[1]!.amount_cents).toBe(30_00)
  })

  it('is a no-op when no derived line is present', () => {
    const lines = [line({ id: 'm1' }), line({ id: 'm2', amount_cents: 5_00 })]
    const result = applyBreakdownAmounts(lines, new Map([['b1', 99_00]]))
    expect(result).toBe(lines)
  })

  it('feeds the derived total through the Summary reconciliation', () => {
    const lines = [line({ id: 'd', line_group: 'wants', breakdown_id: 'b1', amount_cents: 0 })]
    const substituted = applyBreakdownAmounts(lines, new Map([['b1', 260_00]]))
    const summary = summarise(
      {
        afterTaxIncomeAnnualCents: 0,
        nonTaxableInflows: [],
        budgetLines: substituted.map((entry) => ({
          group: entry.line_group,
          amountCents: entry.amount_cents,
          frequency: entry.frequency,
        })),
        temporaryItems: [],
      },
      new Date('2026-01-01'),
    )
    // $260/year of the breakdown lands in Wants as an annual outgoing.
    expect(summary.groups.wants.annualCents).toBe(260_00)
    expect(summary.outgoings.annualCents).toBe(260_00)
  })
})
