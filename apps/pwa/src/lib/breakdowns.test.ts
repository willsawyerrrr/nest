import { describe, expect, it } from 'vitest'
import { breakdownAnnualTotals, breakdownItemCounts, reconcileBreakdownLines } from './breakdowns'
import type { Breakdown } from '../hooks/useBreakdowns'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import type { BudgetLine } from '../hooks/useBudgetLines'

function breakdown(overrides: Partial<Breakdown> = {}): Breakdown {
  return {
    id: 'b1',
    household_id: 'h',
    name: 'Medications',
    line_group: 'needs',
    kind: 'generic',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function item(overrides: Partial<BreakdownItem> = {}): BreakdownItem {
  return {
    id: 'i1',
    household_id: 'h',
    breakdown_id: 'b1',
    name: 'Item',
    amount_cents: 10_00,
    frequency: 'monthly',
    interval_weeks: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: 'l1',
    household_id: 'h',
    line_group: 'needs',
    name: 'Line',
    amount_cents: 0,
    frequency: 'annual',
    interval_weeks: null,
    goal_id: null,
    derived_source: null,
    destination_account_id: null,
    breakdown_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('breakdownAnnualTotals', () => {
  it('sums a generic breakdown’s items and takes the gift total for a gift breakdown', () => {
    const breakdowns = [
      breakdown({ id: 'g', kind: 'generic' }),
      breakdown({ id: 'x', kind: 'gift', name: 'Gifts' }),
    ]
    const items = [
      item({ id: 'i1', breakdown_id: 'g', amount_cents: 10_00, frequency: 'monthly' }),
      item({ id: 'i2', breakdown_id: 'g', amount_cents: 5_00, frequency: 'annual' }),
    ]
    const totals = breakdownAnnualTotals(breakdowns, items, 250_00)
    // $10/month → $120/year, plus $5/year = $125/year.
    expect(totals.get('g')).toBe(125_00)
    expect(totals.get('x')).toBe(250_00)
  })
})

describe('breakdownItemCounts', () => {
  it('counts a generic breakdown’s items and the gift budgets for a gift breakdown', () => {
    const breakdowns = [
      breakdown({ id: 'g', kind: 'generic' }),
      breakdown({ id: 'x', kind: 'gift' }),
    ]
    const items = [item({ id: 'i1', breakdown_id: 'g' }), item({ id: 'i2', breakdown_id: 'g' })]
    const counts = breakdownItemCounts(breakdowns, items, 3)
    expect(counts.get('g')).toBe(2)
    expect(counts.get('x')).toBe(3)
  })
})

describe('reconcileBreakdownLines', () => {
  it('creates a derived line for a breakdown with items but no line', () => {
    const b = breakdown({ id: 'g', name: 'Medications', line_group: 'needs' })
    const ops = reconcileBreakdownLines([b], new Map([['g', 120_00]]), new Map([['g', 2]]), [])
    expect(ops.create).toEqual([
      {
        line_group: 'needs',
        name: 'Medications',
        amount_cents: 120_00,
        frequency: 'annual',
        interval_weeks: null,
        goal_id: null,
        derived_source: null,
        breakdown_id: 'g',
        destination_account_id: null,
      },
    ])
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('updates a drifted line, preserving its routing', () => {
    const b = breakdown({ id: 'g', name: 'Medications', line_group: 'wants' })
    const existing = line({
      id: 'l1',
      breakdown_id: 'g',
      name: 'Meds',
      line_group: 'needs',
      amount_cents: 50_00,
      destination_account_id: 'acc1',
    })
    const ops = reconcileBreakdownLines([b], new Map([['g', 120_00]]), new Map([['g', 2]]), [
      existing,
    ])
    expect(ops.update).toEqual([
      {
        id: 'l1',
        input: {
          line_group: 'wants',
          name: 'Medications',
          amount_cents: 120_00,
          frequency: 'annual',
          interval_weeks: null,
          goal_id: null,
          derived_source: null,
          breakdown_id: 'g',
          destination_account_id: 'acc1',
        },
      },
    ])
    expect(ops.create).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('is a no-op when the line already matches its breakdown', () => {
    const b = breakdown({ id: 'g', name: 'Medications', line_group: 'needs' })
    const existing = line({
      id: 'l1',
      breakdown_id: 'g',
      name: 'Medications',
      line_group: 'needs',
      amount_cents: 120_00,
      frequency: 'annual',
    })
    const ops = reconcileBreakdownLines([b], new Map([['g', 120_00]]), new Map([['g', 2]]), [
      existing,
    ])
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('removes an empty breakdown’s line', () => {
    const b = breakdown({ id: 'g' })
    const existing = line({ id: 'l1', breakdown_id: 'g' })
    const ops = reconcileBreakdownLines([b], new Map([['g', 0]]), new Map([['g', 0]]), [existing])
    expect(ops.remove).toEqual(['l1'])
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
  })

  it('keeps an empty breakdown’s line when it carries routing', () => {
    const b = breakdown({ id: 'g' })
    const existing = line({ id: 'l1', breakdown_id: 'g', destination_account_id: 'acc1' })
    const ops = reconcileBreakdownLines([b], new Map([['g', 0]]), new Map([['g', 0]]), [existing])
    expect(ops.remove).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
    expect(ops.create).toHaveLength(0)
  })
})
