import { describe, expect, it } from 'vitest'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import type { Breakdown } from '../hooks/useBreakdowns'
import type { BudgetLine } from '../hooks/useBudgetLines'
import {
  breakdownItemCounts,
  breakdownTotalsByBreakdownId,
  derivedAmountContext,
  reconcileBreakdownLines,
  type DerivedAmountContext,
} from './breakdowns'
import type { DirectoryAccount, GiftBudget, GiftRecipient } from './gifts'

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

function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: 'l1',
    household_id: 'h',
    line_group: 'needs',
    name: 'Line',
    amount_cents: 0,
    frequency: 'annual',
    interval_count: null,
    goal_id: null,
    destination_account_id: null,
    breakdown_id: null,
    gift_recipient_member_id: null,
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
    giftBreakdownId: null,
    giftTotalsByMember: new Map(),
    ...overrides,
  }
}

/** Reconciles with the members and directory defaulting to empty for the generic cases. */
function reconcile(
  breakdowns: Breakdown[],
  ctx: DerivedAmountContext,
  counts: Map<string, number>,
  lines: BudgetLine[],
  memberNames: Map<string, string>,
  members: { id: string }[] = [],
  directory: DirectoryAccount[] = [],
) {
  return reconcileBreakdownLines(breakdowns, ctx, counts, lines, memberNames, members, directory)
}

describe('derivedAmountContext', () => {
  it('sums a generic breakdown’s items and partitions the gift breakdown', () => {
    const breakdowns = [
      breakdown({ id: 'g', kind: 'generic' }),
      breakdown({ id: 'x', kind: 'gift', name: 'Gifts' }),
    ]
    const items = [
      item({ id: 'i1', breakdown_id: 'g', amount_cents: 10_00, frequency: 'monthly' }),
      item({ id: 'i2', breakdown_id: 'g', amount_cents: 5_00, frequency: 'annual' }),
    ]
    const recipients = [recipient('r-sam', 'm-sam'), recipient('r-ext', null)]
    const budgets = [budget('bd1', 'r-sam', 120_00), budget('bd2', 'r-ext', 30_00)]
    const result = derivedAmountContext(breakdowns, items, budgets, recipients)
    // $10/month → $120/year, plus $5/year = $125/year.
    expect(result.genericTotalsByBreakdownId.get('g')).toBe(125_00)
    expect(result.giftBreakdownId).toBe('x')
    expect(result.giftTotalsByMember.get('m-sam')).toBe(120_00)
    expect(result.giftTotalsByMember.get(null)).toBe(30_00)
  })

  it('leaves the gift breakdown id null when there is no gift breakdown', () => {
    const result = derivedAmountContext([breakdown({ id: 'g' })], [], [], [])
    expect(result.giftBreakdownId).toBeNull()
  })
})

describe('breakdownTotalsByBreakdownId', () => {
  it('gives each generic breakdown its total and the gift breakdown the partition sum', () => {
    const breakdowns = [breakdown({ id: 'g' }), breakdown({ id: 'x', kind: 'gift' })]
    const ctx = context({
      genericTotalsByBreakdownId: new Map([['g', 125_00]]),
      giftBreakdownId: 'x',
      giftTotalsByMember: new Map([
        ['m-sam', 120_00],
        [null, 30_00],
      ]),
    })
    const totals = breakdownTotalsByBreakdownId(breakdowns, ctx)
    expect(totals.get('g')).toBe(125_00)
    expect(totals.get('x')).toBe(150_00)
  })

  it('falls back to zero for a generic breakdown absent from the context', () => {
    const totals = breakdownTotalsByBreakdownId([breakdown({ id: 'g' })], context())
    expect(totals.get('g')).toBe(0)
  })
})

describe('breakdownItemCounts', () => {
  it('counts each breakdown’s items', () => {
    const breakdowns = [breakdown({ id: 'g' }), breakdown({ id: 'x', kind: 'gift' })]
    const items = [item({ id: 'i1', breakdown_id: 'g' }), item({ id: 'i2', breakdown_id: 'g' })]
    const counts = breakdownItemCounts(breakdowns, items)
    expect(counts.get('g')).toBe(2)
    expect(counts.get('x')).toBe(0)
  })
})

describe('reconcileBreakdownLines — generic breakdowns', () => {
  const gen = (total: number) => context({ genericTotalsByBreakdownId: new Map([['g', total]]) })

  it('creates a derived line for a breakdown with items but no line', () => {
    const b = breakdown({ id: 'g', name: 'Medications', line_group: 'needs' })
    const ops = reconcile([b], gen(120_00), new Map([['g', 2]]), [], new Map())
    expect(ops.create).toEqual([
      {
        line_group: 'needs',
        name: 'Medications',
        amount_cents: 120_00,
        frequency: 'annual',
        interval_count: null,
        goal_id: null,
        breakdown_id: 'g',
        destination_account_id: null,
        gift_recipient_member_id: null,
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
    const ops = reconcile([b], gen(120_00), new Map([['g', 2]]), [existing], new Map())
    expect(ops.update).toEqual([
      {
        id: 'l1',
        input: {
          line_group: 'wants',
          name: 'Medications',
          amount_cents: 120_00,
          frequency: 'annual',
          interval_count: null,
          goal_id: null,
          breakdown_id: 'g',
          destination_account_id: 'acc1',
          gift_recipient_member_id: null,
        },
      },
    ])
    expect(ops.create).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('updates the line when only a rolled-up item amount changes', () => {
    const b = breakdown({ id: 'g', name: 'Medications', line_group: 'needs' })
    const existing = line({
      id: 'l1',
      breakdown_id: 'g',
      name: 'Medications',
      line_group: 'needs',
      amount_cents: 120_00,
      frequency: 'annual',
    })
    const ops = reconcile([b], gen(180_00), new Map([['g', 2]]), [existing], new Map())
    expect(ops.update[0]!.input.amount_cents).toBe(180_00)
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
    const ops = reconcile([b], gen(120_00), new Map([['g', 2]]), [existing], new Map())
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('removes an empty breakdown’s line', () => {
    const b = breakdown({ id: 'g' })
    const existing = line({ id: 'l1', breakdown_id: 'g' })
    const ops = reconcile([b], gen(0), new Map([['g', 0]]), [existing], new Map())
    expect(ops.remove).toEqual(['l1'])
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
  })

  it('nulls the funding account of a line under a goal-routed breakdown', () => {
    const b = breakdown({ id: 'g', name: 'Deposit', line_group: 'savings' })
    const existing = line({
      id: 'l1',
      breakdown_id: 'g',
      name: 'Deposit',
      line_group: 'savings',
      amount_cents: 120_00,
      frequency: 'annual',
      destination_account_id: 'acc1',
    })
    const ops = reconcile([b], gen(120_00), new Map([['g', 2]]), [existing], new Map())
    expect(ops.update[0]!.input.destination_account_id).toBeNull()
    expect(ops.create).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('keeps an emptied breakdown’s routed line at $0 rather than removing it', () => {
    const b = breakdown({ id: 'g' })
    const existing = line({
      id: 'l1',
      breakdown_id: 'g',
      amount_cents: 50_00,
      destination_account_id: 'acc1',
    })
    const ops = reconcile([b], gen(0), new Map([['g', 0]]), [existing], new Map())
    expect(ops.remove).toHaveLength(0)
    expect(ops.create).toHaveLength(0)
    expect(ops.update[0]!.input.amount_cents).toBe(0)
    expect(ops.update[0]!.input.destination_account_id).toBe('acc1')
  })

  it('does nothing for a breakdown with no items and no line, even absent from counts', () => {
    // The count map omits this breakdown entirely, exercising the count fallback,
    // and there is no line to create, update, or remove.
    const b = breakdown({ id: 'g' })
    const ops = reconcile([b], context(), new Map(), [], new Map())
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('leaves an emptied routed line alone once it already reads $0', () => {
    const b = breakdown({ id: 'g' })
    const existing = line({
      id: 'l1',
      breakdown_id: 'g',
      name: 'Medications',
      amount_cents: 0,
      destination_account_id: 'acc1',
    })
    const ops = reconcile([b], gen(0), new Map([['g', 0]]), [existing], new Map())
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })
})

describe('reconcileBreakdownLines — gift breakdown partitions', () => {
  const gift = breakdown({ id: 'x', kind: 'gift', name: 'Gifts', line_group: 'wants' })
  const memberNames = new Map([
    ['m-sam', 'Sam'],
    ['m-will', 'Will'],
  ])
  const giftContext = (entries: [string | null, number][]) =>
    context({ giftBreakdownId: 'x', giftTotalsByMember: new Map(entries) })

  const members = [{ id: 'm-sam' }, { id: 'm-will' }]
  // Each member's own spending account, the shared joint account (owner null), and
  // a saver, so the buyer-account resolution has a full directory to filter.
  const directory: DirectoryAccount[] = [
    { id: 'sam-txn', owner_member_id: 'm-sam', type: 'transaction' },
    { id: 'will-txn', owner_member_id: 'm-will', type: 'transaction' },
    { id: 'joint', owner_member_id: null, type: 'transaction' },
    { id: 'will-saver', owner_member_id: 'm-will', type: 'savings' },
  ]

  it('creates one line per recipient partition, named per member', () => {
    const ops = reconcile(
      [gift],
      giftContext([
        ['m-sam', 120_00],
        ['m-will', 50_00],
        [null, 30_00],
      ]),
      new Map(),
      [],
      memberNames,
    )
    expect(ops.create).toHaveLength(3)
    const byMember = new Map(ops.create.map((c) => [c.gift_recipient_member_id, c]))
    expect(byMember.get('m-sam')).toMatchObject({
      name: 'Gifts for Sam',
      amount_cents: 120_00,
      line_group: 'wants',
      breakdown_id: 'x',
      frequency: 'annual',
    })
    expect(byMember.get('m-will')).toMatchObject({ name: 'Gifts for Will', amount_cents: 50_00 })
    // The external partition keeps the breakdown's own name.
    expect(byMember.get(null)).toMatchObject({ name: 'Gifts', amount_cents: 30_00 })
    // The split lines sum to the old single total.
    expect(ops.create.reduce((sum, c) => sum + c.amount_cents, 0)).toBe(200_00)
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('matches existing lines by their recipient member and updates only drift', () => {
    const samLine = line({
      id: 'sam',
      breakdown_id: 'x',
      gift_recipient_member_id: 'm-sam',
      name: 'Gifts for Sam',
      line_group: 'wants',
      amount_cents: 120_00,
    })
    const extLine = line({
      id: 'ext',
      breakdown_id: 'x',
      gift_recipient_member_id: null,
      name: 'Gifts',
      line_group: 'wants',
      amount_cents: 20_00,
    })
    const ops = reconcile(
      [gift],
      giftContext([
        ['m-sam', 120_00],
        [null, 30_00],
      ]),
      new Map(),
      [samLine, extLine],
      memberNames,
    )
    // Sam's line already matches; only the external line's amount drifted.
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(1)
    expect(ops.update[0]).toMatchObject({ id: 'ext' })
    expect(ops.update[0]!.input.amount_cents).toBe(30_00)
    expect(ops.remove).toHaveLength(0)
  })

  it('removes a partition’s line when its budgets are gone and it is unrouted', () => {
    const willLine = line({
      id: 'will',
      breakdown_id: 'x',
      gift_recipient_member_id: 'm-will',
      name: 'Gifts for Will',
      amount_cents: 50_00,
    })
    const ops = reconcile(
      [gift],
      giftContext([['m-sam', 120_00]]),
      new Map(),
      [willLine],
      memberNames,
    )
    expect(ops.remove).toEqual(['will'])
    expect(ops.create).toHaveLength(1)
    expect(ops.create[0]!.gift_recipient_member_id).toBe('m-sam')
  })

  it('removes an emptied member partition’s line even when it carries auto-routing', () => {
    // A member line's routing is auto-derived, not user-set, so an empty partition
    // never pins the line — it is removed rather than kept at $0.
    const willLine = line({
      id: 'will',
      breakdown_id: 'x',
      gift_recipient_member_id: 'm-will',
      name: 'Gifts for Will',
      line_group: 'wants',
      amount_cents: 50_00,
      destination_account_id: 'sam-txn',
    })
    const ops = reconcile(
      [gift],
      giftContext([['m-sam', 120_00]]),
      new Map(),
      [willLine],
      memberNames,
      members,
      directory,
    )
    expect(ops.remove).toEqual(['will'])
    expect(ops.update.find((u) => u.id === 'will')).toBeUndefined()
  })

  it('funds each member line from the buyer’s (the other member’s) spending account', () => {
    const ops = reconcile(
      [gift],
      giftContext([
        ['m-sam', 120_00],
        ['m-will', 50_00],
        [null, 30_00],
      ]),
      new Map(),
      [],
      memberNames,
      members,
      directory,
    )
    const byMember = new Map(ops.create.map((c) => [c.gift_recipient_member_id, c]))
    // Sam's gifts are bought by Will, funded from Will's spending account, and the
    // reverse for Will; the joint account (owner null) is never chosen.
    expect(byMember.get('m-sam')!.destination_account_id).toBe('will-txn')
    expect(byMember.get('m-will')!.destination_account_id).toBe('sam-txn')
    // The external line stays unrouted (user-configurable), not auto-funded.
    expect(byMember.get(null)!.destination_account_id).toBeNull()
  })

  it('overwrites a stored destination on a member line with the buyer’s account', () => {
    // A manual attempt to route the line elsewhere cannot stick: reconcile forces
    // it back to the buyer's spending account.
    const samLine = line({
      id: 'sam',
      breakdown_id: 'x',
      gift_recipient_member_id: 'm-sam',
      name: 'Gifts for Sam',
      line_group: 'wants',
      amount_cents: 120_00,
      destination_account_id: 'sam-txn',
    })
    const ops = reconcile(
      [gift],
      giftContext([['m-sam', 120_00]]),
      new Map(),
      [samLine],
      memberNames,
      members,
      directory,
    )
    const update = ops.update.find((u) => u.id === 'sam')!
    expect(update.input.destination_account_id).toBe('will-txn')
  })

  it('leaves a member line unrouted when the buyer’s spending account is unsynced', () => {
    // No transaction account for the buyer (Up not connected) resolves to null.
    const ops = reconcile(
      [gift],
      giftContext([['m-sam', 120_00]]),
      new Map(),
      [],
      memberNames,
      members,
      [{ id: 'will-saver', owner_member_id: 'm-will', type: 'savings' }],
    )
    expect(ops.create[0]!.destination_account_id).toBeNull()
  })

  it('clears a member line’s account under a goal-routed group', () => {
    // A gift breakdown moved to a goal-routed group carries no funding account.
    const savingsGift = breakdown({ id: 'x', kind: 'gift', name: 'Gifts', line_group: 'savings' })
    const ops = reconcile(
      [savingsGift],
      giftContext([['m-sam', 120_00]]),
      new Map(),
      [],
      memberNames,
      members,
      directory,
    )
    expect(ops.create[0]!.destination_account_id).toBeNull()
  })

  it('keeps the external line’s user-set routing at $0 when its budgets are gone', () => {
    const extLine = line({
      id: 'ext',
      breakdown_id: 'x',
      gift_recipient_member_id: null,
      name: 'Gifts',
      line_group: 'wants',
      amount_cents: 30_00,
      destination_account_id: 'joint',
    })
    const ops = reconcile(
      [gift],
      giftContext([['m-sam', 120_00]]),
      new Map(),
      [extLine],
      memberNames,
      members,
      directory,
    )
    expect(ops.remove).toHaveLength(0)
    const extUpdate = ops.update.find((u) => u.id === 'ext')!
    expect(extUpdate.input.amount_cents).toBe(0)
    expect(extUpdate.input.destination_account_id).toBe('joint')
  })

  it('removes the external line when its budgets are gone and it is unrouted', () => {
    const extLine = line({
      id: 'ext',
      breakdown_id: 'x',
      gift_recipient_member_id: null,
      name: 'Gifts',
      line_group: 'wants',
      amount_cents: 30_00,
    })
    const ops = reconcile(
      [gift],
      giftContext([['m-sam', 120_00]]),
      new Map(),
      [extLine],
      memberNames,
      members,
      directory,
    )
    expect(ops.remove).toEqual(['ext'])
  })

  it('keeps an existing line’s name when its still-budgeted member is unknown', () => {
    // A member with budgets but absent from the names map keeps its line's own
    // name rather than inventing one.
    const orphan = line({
      id: 'orphan',
      breakdown_id: 'x',
      gift_recipient_member_id: 'm-gone',
      name: 'Gifts for Someone',
      line_group: 'wants',
      amount_cents: 10_00,
    })
    const ops = reconcile(
      [gift],
      giftContext([['m-gone', 40_00]]),
      new Map(),
      [orphan],
      memberNames,
      members,
      directory,
    )
    const update = ops.update.find((u) => u.id === 'orphan')!
    expect(update.input.name).toBe('Gifts for Someone')
    expect(update.input.amount_cents).toBe(40_00)
  })

  it('falls back to the breakdown name when creating a line for an unknown member', () => {
    // A partition whose member is not in the names map and has no existing line
    // takes the breakdown's own name as a last resort.
    const ops = reconcile([gift], giftContext([['m-mystery', 40_00]]), new Map(), [], memberNames)
    expect(ops.create[0]!.name).toBe('Gifts')
    expect(ops.create[0]!.gift_recipient_member_id).toBe('m-mystery')
  })
})
