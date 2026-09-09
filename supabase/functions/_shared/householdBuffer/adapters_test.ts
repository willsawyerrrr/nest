import { assertEquals } from '@std/assert'
import {
  activeNowTaxableInflows,
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
