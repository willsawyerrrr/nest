import { describe, expect, it } from 'vitest'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import type { Breakdown } from '../hooks/useBreakdowns'
import type { BudgetLine } from '../hooks/useBudgetLines'
import {
  breakdownItemCounts,
  breakdownTotalsByBreakdownId,
  derivedAmountContext,
  reconcileBreakdownLines,
  reconcileGiftLines,
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
    is_gift_line: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** A gift line: keyed by `is_gift_line`, never owned by a breakdown. */
function giftLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return line({ is_gift_line: true, breakdown_id: null, ...overrides })
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

/** Reconciles the generic breakdowns. */
function reconcile(
  breakdowns: Breakdown[],
  ctx: DerivedAmountContext,
  counts: Map<string, number>,
  lines: BudgetLine[],
) {
  return reconcileBreakdownLines(breakdowns, ctx, counts, lines)
}

/** Reconciles the gift lines, with members and directory defaulting to empty. */
function reconcileGifts(
  totalsByMember: Map<string | null, number>,
  lines: BudgetLine[],
  memberNames: Map<string, string>,
  members: { id: string }[] = [],
  directory: DirectoryAccount[] = [],
) {
  return reconcileGiftLines(totalsByMember, lines, memberNames, members, directory)
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
    const result = derivedAmountContext(breakdowns, items, budgets, recipients)
    // $10/month → $120/year, plus $5/year = $125/year.
    expect(result.genericTotalsByBreakdownId.get('g')).toBe(125_00)
    expect(result.giftTotalsByMember.get('m-sam')).toBe(120_00)
    expect(result.giftTotalsByMember.get(null)).toBe(30_00)
  })

  it('leaves the gift partition empty when there are no gift budgets', () => {
    const result = derivedAmountContext([breakdown({ id: 'g' })], [], [], [])
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

describe('breakdownItemCounts', () => {
  it('counts each breakdown’s items', () => {
    const breakdowns = [breakdown({ id: 'g' }), breakdown({ id: 'h' })]
    const items = [item({ id: 'i1', breakdown_id: 'g' }), item({ id: 'i2', breakdown_id: 'g' })]
    const counts = breakdownItemCounts(breakdowns, items)
    expect(counts.get('g')).toBe(2)
    expect(counts.get('h')).toBe(0)
  })
})

describe('reconcileBreakdownLines — generic breakdowns', () => {
  const gen = (total: number) => context({ genericTotalsByBreakdownId: new Map([['g', total]]) })

  it('creates a derived line for a breakdown with items but no line', () => {
    const b = breakdown({ id: 'g', name: 'Medications', line_group: 'needs' })
    const ops = reconcile([b], gen(120_00), new Map([['g', 2]]), [])
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
        is_gift_line: false,
      },
    ])
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('skips a lingering gift-kind breakdown rather than treating it as generic', () => {
    // A stale `kind = 'gift'` breakdown (pre-contract-migration) is not reconciled
    // here — gift lines are handled by reconcileGiftLines.
    const b = breakdown({ id: 'x', kind: 'gift', name: 'Gifts' })
    const ops = reconcile([b], context(), new Map([['x', 0]]), [])
    expect(ops.create).toHaveLength(0)
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
    const ops = reconcile([b], gen(120_00), new Map([['g', 2]]), [existing])
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
          is_gift_line: false,
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
    const ops = reconcile([b], gen(180_00), new Map([['g', 2]]), [existing])
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
    const ops = reconcile([b], gen(120_00), new Map([['g', 2]]), [existing])
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('removes an empty breakdown’s line', () => {
    const b = breakdown({ id: 'g' })
    const existing = line({ id: 'l1', breakdown_id: 'g' })
    const ops = reconcile([b], gen(0), new Map([['g', 0]]), [existing])
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
    const ops = reconcile([b], gen(120_00), new Map([['g', 2]]), [existing])
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
    const ops = reconcile([b], gen(0), new Map([['g', 0]]), [existing])
    expect(ops.remove).toHaveLength(0)
    expect(ops.create).toHaveLength(0)
    expect(ops.update[0]!.input.amount_cents).toBe(0)
    expect(ops.update[0]!.input.destination_account_id).toBe('acc1')
  })

  it('does nothing for a breakdown with no items and no line, even absent from counts', () => {
    // The count map omits this breakdown entirely, exercising the count fallback,
    // and there is no line to create, update, or remove.
    const b = breakdown({ id: 'g' })
    const ops = reconcile([b], context(), new Map(), [])
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
    const ops = reconcile([b], gen(0), new Map([['g', 0]]), [existing])
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })
})

describe('reconcileGiftLines', () => {
  const memberNames = new Map([
    ['m-sam', 'Sam'],
    ['m-will', 'Will'],
  ])

  const members = [{ id: 'm-sam' }, { id: 'm-will' }]
  // Each member's own spending account, the shared joint account (owner null), and
  // a saver, so the buyer-account resolution has a full directory to filter.
  const directory: DirectoryAccount[] = [
    { id: 'sam-txn', owner_member_id: 'm-sam', type: 'transaction' },
    { id: 'will-txn', owner_member_id: 'm-will', type: 'transaction' },
    { id: 'joint', owner_member_id: null, type: 'transaction' },
    { id: 'will-saver', owner_member_id: 'm-will', type: 'savings' },
  ]

  it('creates one line per recipient partition, named per member and stamped as a gift line', () => {
    const ops = reconcileGifts(
      new Map([
        ['m-sam', 120_00],
        ['m-will', 50_00],
        [null, 30_00],
      ]),
      [],
      memberNames,
    )
    expect(ops.create).toHaveLength(3)
    const byMember = new Map(ops.create.map((c) => [c.gift_recipient_member_id, c]))
    expect(byMember.get('m-sam')).toMatchObject({
      name: 'Gifts for Sam',
      amount_cents: 120_00,
      line_group: 'wants',
      breakdown_id: null,
      is_gift_line: true,
      frequency: 'annual',
    })
    expect(byMember.get('m-will')).toMatchObject({ name: 'Gifts for Will', amount_cents: 50_00 })
    // The external partition takes the stable external-line name.
    expect(byMember.get(null)).toMatchObject({
      name: 'Gifts',
      amount_cents: 30_00,
      breakdown_id: null,
      is_gift_line: true,
    })
    // The split lines sum to the household's total gift spend.
    expect(ops.create.reduce((sum, c) => sum + c.amount_cents, 0)).toBe(200_00)
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('matches existing lines by their recipient member and updates only drift', () => {
    const samLine = giftLine({
      id: 'sam',
      gift_recipient_member_id: 'm-sam',
      name: 'Gifts for Sam',
      line_group: 'wants',
      amount_cents: 120_00,
    })
    const extLine = giftLine({
      id: 'ext',
      gift_recipient_member_id: null,
      name: 'Gifts',
      line_group: 'wants',
      amount_cents: 20_00,
    })
    const ops = reconcileGifts(
      new Map([
        ['m-sam', 120_00],
        [null, 30_00],
      ]),
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
    const willLine = giftLine({
      id: 'will',
      gift_recipient_member_id: 'm-will',
      name: 'Gifts for Will',
      amount_cents: 50_00,
    })
    const ops = reconcileGifts(new Map([['m-sam', 120_00]]), [willLine], memberNames)
    expect(ops.remove).toEqual(['will'])
    expect(ops.create).toHaveLength(1)
    expect(ops.create[0]!.gift_recipient_member_id).toBe('m-sam')
  })

  it('removes an emptied member partition’s line even when it carries auto-routing', () => {
    // A member line's routing is auto-derived, not user-set, so an empty partition
    // never pins the line — it is removed rather than kept at $0.
    const willLine = giftLine({
      id: 'will',
      gift_recipient_member_id: 'm-will',
      name: 'Gifts for Will',
      line_group: 'wants',
      amount_cents: 50_00,
      destination_account_id: 'sam-txn',
    })
    const ops = reconcileGifts(
      new Map([['m-sam', 120_00]]),
      [willLine],
      memberNames,
      members,
      directory,
    )
    expect(ops.remove).toEqual(['will'])
    expect(ops.update.find((u) => u.id === 'will')).toBeUndefined()
  })

  it('funds each member line from the buyer’s (the other member’s) spending account', () => {
    const ops = reconcileGifts(
      new Map([
        ['m-sam', 120_00],
        ['m-will', 50_00],
        [null, 30_00],
      ]),
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
    const samLine = giftLine({
      id: 'sam',
      gift_recipient_member_id: 'm-sam',
      name: 'Gifts for Sam',
      line_group: 'wants',
      amount_cents: 120_00,
      destination_account_id: 'sam-txn',
    })
    const ops = reconcileGifts(
      new Map([['m-sam', 120_00]]),
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
    const ops = reconcileGifts(new Map([['m-sam', 120_00]]), [], memberNames, members, [
      { id: 'will-saver', owner_member_id: 'm-will', type: 'savings' },
    ])
    expect(ops.create[0]!.destination_account_id).toBeNull()
  })

  it('clears a member line’s account under a goal-routed group', () => {
    // A gift line moved to a goal-routed group carries no funding account.
    const samSavings = giftLine({
      id: 'sam',
      gift_recipient_member_id: 'm-sam',
      name: 'Gifts for Sam',
      line_group: 'savings',
      amount_cents: 120_00,
      destination_account_id: 'sam-txn',
    })
    const ops = reconcileGifts(
      new Map([['m-sam', 120_00]]),
      [samSavings],
      memberNames,
      members,
      directory,
    )
    const update = ops.update.find((u) => u.id === 'sam')!
    expect(update.input.destination_account_id).toBeNull()
  })

  it('keeps the external line’s user-set routing at $0 when its budgets are gone', () => {
    const extLine = giftLine({
      id: 'ext',
      gift_recipient_member_id: null,
      name: 'Gifts',
      line_group: 'wants',
      amount_cents: 30_00,
      destination_account_id: 'joint',
    })
    const ops = reconcileGifts(
      new Map([['m-sam', 120_00]]),
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
    const extLine = giftLine({
      id: 'ext',
      gift_recipient_member_id: null,
      name: 'Gifts',
      line_group: 'wants',
      amount_cents: 30_00,
    })
    const ops = reconcileGifts(
      new Map([['m-sam', 120_00]]),
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
    const orphan = giftLine({
      id: 'orphan',
      gift_recipient_member_id: 'm-gone',
      name: 'Gifts for Someone',
      line_group: 'wants',
      amount_cents: 10_00,
    })
    const ops = reconcileGifts(
      new Map([['m-gone', 40_00]]),
      [orphan],
      memberNames,
      members,
      directory,
    )
    const update = ops.update.find((u) => u.id === 'orphan')!
    expect(update.input.name).toBe('Gifts for Someone')
    expect(update.input.amount_cents).toBe(40_00)
  })

  it('falls back to the external name when creating a line for an unknown member', () => {
    // A partition whose member is not in the names map and has no existing line
    // takes the stable external-line name as a last resort.
    const ops = reconcileGifts(new Map([['m-mystery', 40_00]]), [], memberNames)
    expect(ops.create[0]!.name).toBe('Gifts')
    expect(ops.create[0]!.gift_recipient_member_id).toBe('m-mystery')
  })

  it('preserves each gift line’s own group, queuing no update when only the group differs', () => {
    // Two member lines sit in different groups from each other and from the default;
    // their groups are per-line, so reconcile leaves them untouched.
    const samLine = giftLine({
      id: 'sam',
      gift_recipient_member_id: 'm-sam',
      name: 'Gifts for Sam',
      line_group: 'wants',
      amount_cents: 120_00,
      destination_account_id: 'will-txn',
    })
    const willLine = giftLine({
      id: 'will',
      gift_recipient_member_id: 'm-will',
      name: 'Gifts for Will',
      line_group: 'discretionary',
      amount_cents: 50_00,
      destination_account_id: 'sam-txn',
    })
    const ops = reconcileGifts(
      new Map([
        ['m-sam', 120_00],
        ['m-will', 50_00],
      ]),
      [samLine, willLine],
      memberNames,
      members,
      directory,
    )
    // Will's group (discretionary) is not forced back to the default, and Sam's is
    // left as is — neither queues an update.
    expect(ops.create).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
    expect(ops.remove).toHaveLength(0)
  })

  it('seeds a brand-new gift line into the default group', () => {
    const ops = reconcileGifts(new Map([['m-sam', 120_00]]), [], memberNames, members, directory)
    expect(ops.create).toHaveLength(1)
    expect(ops.create[0]!.line_group).toBe('wants')
  })

  it('ignores non-gift lines when matching partitions', () => {
    // A generic breakdown line (not a gift line) is invisible to the gift reconcile.
    const generic = line({ id: 'gen', breakdown_id: 'b1', name: 'Meds', amount_cents: 99_00 })
    const ops = reconcileGifts(
      new Map([['m-sam', 120_00]]),
      [generic],
      memberNames,
      members,
      directory,
    )
    expect(ops.create).toHaveLength(1)
    expect(ops.create[0]!.gift_recipient_member_id).toBe('m-sam')
    expect(ops.remove).toHaveLength(0)
    expect(ops.update).toHaveLength(0)
  })
})
