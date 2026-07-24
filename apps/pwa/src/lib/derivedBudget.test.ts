import { describe, expect, it } from 'vitest'
import { summarise } from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { DerivedAmountContext } from './breakdowns'
import { applyBreakdownAmounts } from './derivedBudget'

function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: 'l1',
    household_id: 'h',
    line_group: 'wants',
    name: 'Line',
    amount_cents: 10_00,
    frequency: 'monthly',
    interval_count: null,
    goal_id: null,
    destination_account_id: null,
    breakdown_id: null,
    gift_recipient_member_id: null,
    is_gift_line: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function context(overrides: Partial<DerivedAmountContext> = {}): DerivedAmountContext {
  return {
    genericTotalsByBreakdownId: new Map(),
    giftTotalsByMember: new Map(),
    ...overrides,
  }
}

describe('applyBreakdownAmounts', () => {
  it('replaces a generic derived line with its breakdown’s annual total', () => {
    const lines = [line({ id: 'd', breakdown_id: 'b1', amount_cents: 0, frequency: 'monthly' })]
    const result = applyBreakdownAmounts(
      lines,
      context({ genericTotalsByBreakdownId: new Map([['b1', 150_00]]) }),
    )
    expect(result[0]!.amount_cents).toBe(150_00)
    expect(result[0]!.frequency).toBe('annual')
  })

  it('takes a gift line’s amount from its recipient partition', () => {
    const lines = [
      line({ id: 'sam', is_gift_line: true, gift_recipient_member_id: 'm-sam', amount_cents: 0 }),
      line({ id: 'ext', is_gift_line: true, gift_recipient_member_id: null, amount_cents: 0 }),
    ]
    const result = applyBreakdownAmounts(
      lines,
      context({
        giftTotalsByMember: new Map([
          ['m-sam', 120_00],
          [null, 30_00],
        ]),
      }),
    )
    expect(result[0]!.amount_cents).toBe(120_00)
    expect(result[1]!.amount_cents).toBe(30_00)
  })

  it('falls back to zero when a gift partition has no budgets', () => {
    const lines = [
      line({
        id: 'sam',
        is_gift_line: true,
        gift_recipient_member_id: 'm-sam',
        amount_cents: 42_00,
      }),
    ]
    const result = applyBreakdownAmounts(lines, context())
    expect(result[0]!.amount_cents).toBe(0)
  })

  it('falls back to zero when a generic breakdown is absent from the context', () => {
    const lines = [line({ id: 'd', breakdown_id: 'b1', amount_cents: 42_00 })]
    const result = applyBreakdownAmounts(lines, context())
    expect(result[0]!.amount_cents).toBe(0)
  })

  it('leaves manual lines untouched', () => {
    const manual = line({ id: 'm', amount_cents: 42_00, frequency: 'weekly' })
    const derived = line({ id: 'd', breakdown_id: 'b1', amount_cents: 0 })
    const result = applyBreakdownAmounts(
      [manual, derived],
      context({ genericTotalsByBreakdownId: new Map([['b1', 30_00]]) }),
    )
    expect(result[0]).toEqual(manual)
    expect(result[1]!.amount_cents).toBe(30_00)
  })

  it('is a no-op when no derived line is present', () => {
    const lines = [line({ id: 'm1' }), line({ id: 'm2', amount_cents: 5_00 })]
    const result = applyBreakdownAmounts(
      lines,
      context({ genericTotalsByBreakdownId: new Map([['b1', 99_00]]) }),
    )
    expect(result).toBe(lines)
  })

  it('feeds the derived total through the Summary reconciliation', () => {
    const lines = [line({ id: 'd', line_group: 'wants', breakdown_id: 'b1', amount_cents: 0 })]
    const substituted = applyBreakdownAmounts(
      lines,
      context({ genericTotalsByBreakdownId: new Map([['b1', 260_00]]) }),
    )
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
