import { describe, expect, it } from 'vitest'
import type { InflowRow, InterestGoalRow, SaverRow, TaxProfileRow } from '../rows.ts'
import { estimateHouseholdTaxFromRows, projectedInterestIncomeInputs } from '../tax.ts'

function inflow(overrides: Partial<InflowRow> = {}): InflowRow {
  return {
    member_id: 'm1',
    taxable: true,
    attracts_super: true,
    type: 'salary',
    schedule: 'every_n_weeks',
    interval_count: 4,
    paid_on: null,
    one_off_tax_treatment: null,
    years_of_service: null,
    is_joint: false,
    member_split_percent: null,
    amount_cents: 300_00,
    hourly_rate_cents: null,
    hours_per_period: null,
    starts_on: null,
    ends_on: null,
    ...overrides,
  }
}

const profile: TaxProfileRow = {
  member_id: 'm1',
  residency: 'resident',
  has_private_hospital_cover: false,
}

function member(overrides: Partial<{ id: string; date_of_birth: string | null }> = {}) {
  return { id: 'm1', date_of_birth: null, ...overrides }
}

function goal(overrides: Partial<InterestGoalRow> = {}): InterestGoalRow {
  return {
    annual_interest_bps: null,
    linked_account_id: null,
    current_balance_cents: 0,
    ...overrides,
  }
}

function saver(overrides: Partial<SaverRow> = {}): SaverRow {
  return { id: 'a1', balance_cents: 0, owner_member_id: null, ...overrides }
}

describe('projectedInterestIncomeInputs', () => {
  const members = [member({ id: 'm1' }), member({ id: 'm2' })]

  it('attributes a goal linked to an individually-owned saver wholly to its owner', () => {
    expect(
      projectedInterestIncomeInputs(
        [goal({ linked_account_id: 'a1', annual_interest_bps: 500 })],
        [saver({ id: 'a1', owner_member_id: 'm2', balance_cents: 20_000_00 })],
        members,
      ),
    ).toEqual([{ memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 1_000_00 }])
  })

  it('splits a joint saver’s interest 50/50, the remainder cent to the last member', () => {
    expect(
      projectedInterestIncomeInputs(
        [goal({ linked_account_id: 'a1', annual_interest_bps: 100 })],
        [saver({ id: 'a1', owner_member_id: null, balance_cents: 10_000_01 })],
        members,
      ),
    ).toEqual([
      { memberId: 'm1', type: 'other', schedule: 'annual', amountCents: 50_00 },
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 50_00 },
    ])
    expect(
      projectedInterestIncomeInputs(
        [goal({ linked_account_id: 'a1', annual_interest_bps: 300 })],
        [saver({ id: 'a1', owner_member_id: null, balance_cents: 33_333_00 })],
        members,
      ),
    ).toEqual([
      { memberId: 'm1', type: 'other', schedule: 'annual', amountCents: 49_999 },
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 50_000 },
    ])
  })

  it('splits 50/50 off current_balance_cents when the goal has no linked account', () => {
    expect(
      projectedInterestIncomeInputs(
        [
          goal({
            linked_account_id: null,
            current_balance_cents: 40_000_00,
            annual_interest_bps: 500,
          }),
        ],
        [],
        members,
      ),
    ).toEqual([
      { memberId: 'm1', type: 'other', schedule: 'annual', amountCents: 1_000_00 },
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 1_000_00 },
    ])
  })

  it('splits 50/50 off current_balance_cents when the linked account is unknown', () => {
    expect(
      projectedInterestIncomeInputs(
        [
          goal({
            linked_account_id: 'missing',
            current_balance_cents: 40_000_00,
            annual_interest_bps: 500,
          }),
        ],
        [],
        members,
      ).map((i) => i.amountCents),
    ).toEqual([1_000_00, 1_000_00])
  })

  it('emits nothing for a goal with a null or zero interest rate, or a nil interest figure', () => {
    expect(
      projectedInterestIncomeInputs(
        [
          goal({ annual_interest_bps: null, current_balance_cents: 50_000_00 }),
          goal({ annual_interest_bps: 0, current_balance_cents: 50_000_00 }),
          goal({ annual_interest_bps: 500, current_balance_cents: 0 }),
        ],
        [],
        members,
      ),
    ).toEqual([])
  })

  it('drops a member whose split share rounds to nothing', () => {
    expect(
      projectedInterestIncomeInputs(
        [goal({ annual_interest_bps: 100, current_balance_cents: 100 })],
        [],
        members,
      ),
    ).toEqual([{ memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 1 }])
    expect(
      projectedInterestIncomeInputs(
        [goal({ annual_interest_bps: 500, current_balance_cents: 20_000_00 })],
        [],
        [],
      ),
    ).toEqual([])
  })

  it('raises annual tax and moves the EOFY balance when threaded into the estimate', () => {
    const salary = inflow({ schedule: 'annual', amount_cents: 120_000_00 })
    const interest = projectedInterestIncomeInputs(
      [goal({ annual_interest_bps: 500, current_balance_cents: 100_000_00 })],
      [],
      [member({ id: 'm1' })],
    )
    const withheld = new Map([['m1', 30_000_00]])
    const withoutInterest = estimateHouseholdTaxFromRows(
      [salary],
      [profile],
      [],
      [],
      [],
      undefined,
      withheld,
      [],
    )
    const withInterest = estimateHouseholdTaxFromRows(
      [salary],
      [profile],
      [],
      [],
      [],
      undefined,
      withheld,
      [],
      interest,
    )
    expect(withInterest.annualGrossCents).toBe(withoutInterest.annualGrossCents + 5_000_00)
    expect(withInterest.annualTaxCents).toBeGreaterThan(withoutInterest.annualTaxCents)
    expect(withInterest.members[0]!.breakdown.balanceCents).toBeGreaterThan(
      withoutInterest.members[0]!.breakdown.balanceCents,
    )
  })
})
