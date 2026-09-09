import { assertEquals } from '@std/assert'
import {
  activeNowTaxableInflows,
  applyBreakdownAmounts,
  type BudgetLineRow,
  derivedAmountContext,
  giftTotalsByMember,
  projectedInterestIncomeInputs,
  splitAcrossMembers,
} from './adapters.ts'
import type { InflowRow } from './tax.ts'

function inflow(overrides: Partial<InflowRow> = {}): InflowRow {
  return {
    member_id: 'm1',
    taxable: true,
    type: 'salary',
    schedule: 'annual',
    amount_cents: 120_000_00,
    hourly_rate_cents: null,
    hours_per_period: null,
    interval_count: null,
    starts_on: null,
    ends_on: null,
    paid_on: null,
    attracts_super: true,
    one_off_tax_treatment: null,
    years_of_service: null,
    is_joint: false,
    member_split_percent: null,
    ...overrides,
  }
}

function line(overrides: Partial<BudgetLineRow> = {}): BudgetLineRow {
  return {
    line_group: 'wants',
    amount_cents: 10_00,
    frequency: 'monthly',
    interval_count: null,
    is_gift_line: false,
    breakdown_id: null,
    gift_recipient_member_id: null,
    ...overrides,
  }
}

// ── activeNowTaxableInflows ────────────────────────────────────────────────

const NOW = new Date('2026-12-01T00:00:00Z')

Deno.test('activeNowTaxableInflows keeps an active recurring inflow with its effective dates cleared', () => {
  const dated = inflow({ starts_on: '2026-07-01', ends_on: '2027-06-30' })
  assertEquals(activeNowTaxableInflows([dated], NOW), [{
    ...dated,
    starts_on: null,
    ends_on: null,
  }])
})

Deno.test('activeNowTaxableInflows leaves an open-ended recurring inflow untouched', () => {
  const recurring = inflow()
  assertEquals(activeNowTaxableInflows([recurring], NOW), [recurring])
})

Deno.test('activeNowTaxableInflows drops a recurring inflow outside its window', () => {
  assertEquals(activeNowTaxableInflows([inflow({ ends_on: '2026-09-30' })], NOW), [])
  assertEquals(activeNowTaxableInflows([inflow({ starts_on: '2027-03-01' })], NOW), [])
})

Deno.test('activeNowTaxableInflows passes a one-off through unchanged, dates and all', () => {
  const oneOff = inflow({ schedule: null, paid_on: '2026-08-15' })
  assertEquals(activeNowTaxableInflows([oneOff], NOW), [oneOff])
})

Deno.test('activeNowTaxableInflows drops a non-taxable inflow', () => {
  assertEquals(activeNowTaxableInflows([inflow({ taxable: false })], NOW), [])
})

// ── splitAcrossMembers ────────────────────────────────────────────────────

Deno.test('splitAcrossMembers splits evenly and gives the remainder cent to the last member', () => {
  assertEquals(splitAcrossMembers(100_00, ['m1', 'm2']), [50_00, 50_00])
  assertEquals(splitAcrossMembers(100_01, ['m1', 'm2']), [50_00, 50_01])
  assertEquals(splitAcrossMembers(10, ['m1', 'm2', 'm3']), [3, 3, 4])
  assertEquals(splitAcrossMembers(100_00, []), [])
})

// ── projectedInterestIncomeInputs ─────────────────────────────────────────

const members = [{ id: 'm1' }, { id: 'm2' }]

Deno.test('projectedInterestIncomeInputs attributes a goal linked to an owned saver to its owner', () => {
  assertEquals(
    projectedInterestIncomeInputs(
      [{ annual_interest_bps: 500, linked_account_id: 'a1', current_balance_cents: 0 }],
      [{ id: 'a1', owner_member_id: 'm2', balance_cents: 20_000_00 }],
      members,
    ),
    [{ memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 1_000_00 }],
  )
})

Deno.test('projectedInterestIncomeInputs splits a joint saver 50/50 with the remainder cent last', () => {
  assertEquals(
    projectedInterestIncomeInputs(
      [{ annual_interest_bps: 300, linked_account_id: 'a1', current_balance_cents: 0 }],
      [{ id: 'a1', owner_member_id: null, balance_cents: 33_333_00 }],
      members,
    ),
    [
      { memberId: 'm1', type: 'other', schedule: 'annual', amountCents: 49_999 },
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 50_000 },
    ],
  )
})

Deno.test('projectedInterestIncomeInputs falls back to the goal balance with no resolvable link', () => {
  assertEquals(
    projectedInterestIncomeInputs(
      [{
        annual_interest_bps: 500,
        linked_account_id: 'missing',
        current_balance_cents: 40_000_00,
      }],
      [],
      members,
    ).map((input) => input.amountCents),
    [1_000_00, 1_000_00],
  )
})

Deno.test('projectedInterestIncomeInputs emits nothing for a null/zero rate or nil figure', () => {
  assertEquals(
    projectedInterestIncomeInputs(
      [
        { annual_interest_bps: null, linked_account_id: null, current_balance_cents: 50_000_00 },
        { annual_interest_bps: 0, linked_account_id: null, current_balance_cents: 50_000_00 },
        { annual_interest_bps: 500, linked_account_id: null, current_balance_cents: 0 },
      ],
      [],
      members,
    ),
    [],
  )
})

Deno.test('projectedInterestIncomeInputs drops a member whose split share rounds to nothing', () => {
  assertEquals(
    projectedInterestIncomeInputs(
      [{ annual_interest_bps: 100, linked_account_id: null, current_balance_cents: 100 }],
      [],
      members,
    ),
    [{ memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 1 }],
  )
})

// ── giftTotalsByMember ────────────────────────────────────────────────────

Deno.test('giftTotalsByMember partitions budgets by recipient member, external into null', () => {
  const totals = giftTotalsByMember(
    [
      { recipient_id: 'r-sam', budgeted_amount_cents: 120_00 },
      { recipient_id: 'r-ext', budgeted_amount_cents: 30_00 },
    ],
    [{ id: 'r-sam', member_id: 'm-sam' }, { id: 'r-ext', member_id: null }],
  )
  assertEquals(totals.get('m-sam'), 120_00)
  assertEquals(totals.get(null), 30_00)
})

Deno.test('giftTotalsByMember folds a non-zero discretionary buffer into the external partition', () => {
  const totals = giftTotalsByMember(
    [{ recipient_id: 'r-ext', budgeted_amount_cents: 30_00 }],
    [{ id: 'r-ext', member_id: null }],
    { budgeted_amount_cents: 20_00 },
  )
  assertEquals(totals.get(null), 50_00)
})

Deno.test('giftTotalsByMember leaves the partition empty with no budgets or buffer', () => {
  assertEquals(giftTotalsByMember([], []).size, 0)
})

// ── derivedAmountContext + applyBreakdownAmounts ──────────────────────────

Deno.test('derivedAmountContext sums generic items and partitions gift spend', () => {
  const context = derivedAmountContext(
    [{ id: 'g' }],
    [
      { breakdown_id: 'g', amount_cents: 10_00, frequency: 'monthly', interval_count: null },
      { breakdown_id: 'g', amount_cents: 5_00, frequency: 'annual', interval_count: null },
    ],
    [{ recipient_id: 'r-sam', budgeted_amount_cents: 120_00 }],
    [{ id: 'r-sam', member_id: 'm-sam' }],
    null,
  )
  assertEquals(context.genericTotalsByBreakdownId.get('g'), 125_00)
  assertEquals(context.giftTotalsByMember.get('m-sam'), 120_00)
})

Deno.test('applyBreakdownAmounts is a no-op when no derived line is present', () => {
  const lines = [line({ line_group: 'needs' }), line({ amount_cents: 5_00 })]
  const result = applyBreakdownAmounts(lines, {
    genericTotalsByBreakdownId: new Map([['b1', 99_00]]),
    giftTotalsByMember: new Map(),
  })
  assertEquals(result, lines)
})

Deno.test('applyBreakdownAmounts overrides a generic derived line with its annual total', () => {
  const result = applyBreakdownAmounts([line({ breakdown_id: 'b1', amount_cents: 0 })], {
    genericTotalsByBreakdownId: new Map([['b1', 150_00]]),
    giftTotalsByMember: new Map(),
  })
  assertEquals(result[0].amount_cents, 150_00)
  assertEquals(result[0].frequency, 'annual')
})

Deno.test('applyBreakdownAmounts takes a gift line amount from its recipient partition, zero when absent', () => {
  const result = applyBreakdownAmounts(
    [
      line({ is_gift_line: true, gift_recipient_member_id: 'm-sam', amount_cents: 0 }),
      line({ is_gift_line: true, gift_recipient_member_id: null, amount_cents: 0 }),
      line({ is_gift_line: true, gift_recipient_member_id: 'm-jo', amount_cents: 42_00 }),
    ],
    {
      genericTotalsByBreakdownId: new Map(),
      giftTotalsByMember: new Map<string | null, number>([['m-sam', 120_00], [null, 30_00]]),
    },
  )
  assertEquals(result.map((entry) => entry.amount_cents), [120_00, 30_00, 0])
})
