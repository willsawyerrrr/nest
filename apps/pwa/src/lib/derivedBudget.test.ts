import { describe, expect, it } from 'vitest'
import { summarise } from '@nest/plan'
import { applyGiftDerivedAmounts, applyMedicationDerivedAmounts } from './derivedBudget'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { GiftBudget } from './gifts'
import type { Medication } from './medications'

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
    derived_source: null,
    destination_account_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function giftBudget(id: string, budgeted_amount_cents: number): GiftBudget {
  return {
    id,
    recipient_id: 'r',
    occasion_id: 'o',
    budgeted_amount_cents,
    event_date: null,
    household_id: 'h',
    created_at: '',
    updated_at: '',
  }
}

function medication(
  id: string,
  amount_cents: number,
  frequency: Medication['frequency'] = 'annual',
): Medication {
  return {
    id,
    name: id,
    dose: null,
    amount_cents,
    frequency,
    interval_weeks: null,
    household_id: 'h',
    created_at: '',
    updated_at: '',
  }
}

describe('applyGiftDerivedAmounts', () => {
  it('replaces a gift-derived line with the annual gift total', () => {
    const lines = [
      line({ id: 'gift', derived_source: 'gift', amount_cents: 0, frequency: 'monthly' }),
    ]
    const result = applyGiftDerivedAmounts(lines, [
      giftBudget('b1', 100_00),
      giftBudget('b2', 50_00),
    ])
    expect(result[0]!.amount_cents).toBe(150_00)
    expect(result[0]!.frequency).toBe('annual')
  })

  it('leaves manual lines untouched', () => {
    const manual = line({ id: 'm', amount_cents: 42_00, frequency: 'weekly' })
    const gift = line({ id: 'g', derived_source: 'gift', amount_cents: 0 })
    const result = applyGiftDerivedAmounts([manual, gift], [giftBudget('b1', 30_00)])
    expect(result[0]).toEqual(manual)
    expect(result[1]!.amount_cents).toBe(30_00)
  })

  it('is a no-op when no gift-derived line is present', () => {
    const lines = [line({ id: 'm1' }), line({ id: 'm2', amount_cents: 5_00 })]
    const result = applyGiftDerivedAmounts(lines, [giftBudget('b1', 99_00)])
    expect(result).toBe(lines)
  })

  it('feeds the derived gift total through the Summary reconciliation', () => {
    const lines = [
      line({ id: 'gift', line_group: 'wants', derived_source: 'gift', amount_cents: 0 }),
    ]
    const substituted = applyGiftDerivedAmounts(lines, [giftBudget('b1', 260_00)])
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
    // $260/year of gifts lands in Wants as an annual outgoing.
    expect(summary.groups.wants.annualCents).toBe(260_00)
    expect(summary.outgoings.annualCents).toBe(260_00)
  })
})

describe('applyMedicationDerivedAmounts', () => {
  it('replaces a medication-derived line with the annual medication total', () => {
    const lines = [
      line({
        id: 'meds',
        line_group: 'needs',
        derived_source: 'medication',
        amount_cents: 0,
        frequency: 'monthly',
      }),
    ]
    const result = applyMedicationDerivedAmounts(lines, [
      medication('m1', 20_00, 'monthly'), // $240/yr
      medication('m2', 50_00, 'annual'), // $50/yr
    ])
    expect(result[0]!.amount_cents).toBe(290_00)
    expect(result[0]!.frequency).toBe('annual')
  })

  it('leaves gift-derived and manual lines untouched', () => {
    const manual = line({ id: 'm', amount_cents: 42_00, frequency: 'weekly' })
    const gift = line({ id: 'g', derived_source: 'gift', amount_cents: 7_00 })
    const meds = line({ id: 'meds', derived_source: 'medication', amount_cents: 0 })
    const result = applyMedicationDerivedAmounts(
      [manual, gift, meds],
      [medication('m1', 30_00, 'annual')],
    )
    expect(result[0]).toEqual(manual)
    expect(result[1]).toEqual(gift)
    expect(result[2]!.amount_cents).toBe(30_00)
  })

  it('is a no-op when no medication-derived line is present', () => {
    const lines = [line({ id: 'm1' }), line({ id: 'gift', derived_source: 'gift' })]
    const result = applyMedicationDerivedAmounts(lines, [medication('m1', 99_00)])
    expect(result).toBe(lines)
  })

  it('feeds the derived medication total through the Summary reconciliation', () => {
    const lines = [
      line({ id: 'meds', line_group: 'needs', derived_source: 'medication', amount_cents: 0 }),
    ]
    const substituted = applyMedicationDerivedAmounts(lines, [medication('m1', 130_00, 'annual')])
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
    // $130/year of medications lands in Needs as an annual outgoing.
    expect(summary.groups.needs.annualCents).toBe(130_00)
    expect(summary.outgoings.annualCents).toBe(130_00)
  })
})
