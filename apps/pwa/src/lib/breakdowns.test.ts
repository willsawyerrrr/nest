import { describe, expect, it } from 'vitest'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import type { Breakdown } from '../hooks/useBreakdowns'
import {
  breakdownTotalsByBreakdownId,
  derivedAmountContext,
  type DerivedAmountContext,
} from './breakdowns'
import type { GiftBudget, GiftDiscretionaryBudget, GiftRecipient } from './gifts'

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
    interval_count: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function budget(id: string, recipient_id: string, cents: number): GiftBudget {
  return {
    id,
    recipient_id,
    occasion_id: 'o1',
    budgeted_amount_cents: cents,
    event_date: null,
    household_id: 'h',
    created_at: '',
    updated_at: '',
  }
}

function recipient(id: string, memberId: string | null): GiftRecipient {
  return { id, name: id, member_id: memberId, household_id: 'h', created_at: '', updated_at: '' }
}

function context(overrides: Partial<DerivedAmountContext> = {}): DerivedAmountContext {
  return {
    genericTotalsByBreakdownId: new Map(),
    giftTotalsByMember: new Map(),
    ...overrides,
  }
}

describe('derivedAmountContext', () => {
  it('sums a generic breakdown’s items and partitions the gift spend by member', () => {
    const breakdowns = [breakdown({ id: 'g', kind: 'generic' })]
    const items = [
      item({ id: 'i1', breakdown_id: 'g', amount_cents: 10_00, frequency: 'monthly' }),
      item({ id: 'i2', breakdown_id: 'g', amount_cents: 5_00, frequency: 'annual' }),
    ]
    const recipients = [recipient('r-sam', 'm-sam'), recipient('r-ext', null)]
    const budgets = [budget('bd1', 'r-sam', 120_00), budget('bd2', 'r-ext', 30_00)]
    const result = derivedAmountContext(breakdowns, items, budgets, recipients, null)
    // $10/month → $120/year, plus $5/year = $125/year.
    expect(result.genericTotalsByBreakdownId.get('g')).toBe(125_00)
    expect(result.giftTotalsByMember.get('m-sam')).toBe(120_00)
    expect(result.giftTotalsByMember.get(null)).toBe(30_00)
  })

  it('folds the ad hoc discretionary gift buffer into the external partition', () => {
    const buffer: GiftDiscretionaryBudget = {
      id: 'gdb',
      household_id: 'h',
      budgeted_amount_cents: 500_00,
      created_at: '',
      updated_at: '',
    }
    const result = derivedAmountContext(
      [],
      [],
      [budget('bd', 'r-ext', 30_00)],
      [recipient('r-ext', null)],
      buffer,
    )
    expect(result.giftTotalsByMember.get(null)).toBe(530_00)
  })

  it('leaves the gift partition empty when there are no gift budgets', () => {
    const result = derivedAmountContext([breakdown({ id: 'g' })], [], [], [], null)
    expect(result.giftTotalsByMember.size).toBe(0)
  })
})

describe('breakdownTotalsByBreakdownId', () => {
  it('gives each generic breakdown its rolled-up total', () => {
    const breakdowns = [breakdown({ id: 'g' }), breakdown({ id: 'h' })]
    const ctx = context({
      genericTotalsByBreakdownId: new Map([
        ['g', 125_00],
        ['h', 40_00],
      ]),
    })
    const totals = breakdownTotalsByBreakdownId(breakdowns, ctx)
    expect(totals.get('g')).toBe(125_00)
    expect(totals.get('h')).toBe(40_00)
  })

  it('falls back to zero for a generic breakdown absent from the context', () => {
    const totals = breakdownTotalsByBreakdownId([breakdown({ id: 'g' })], context())
    expect(totals.get('g')).toBe(0)
  })
})
