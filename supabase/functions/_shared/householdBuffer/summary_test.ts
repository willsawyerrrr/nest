import { assert, assertEquals } from '@std/assert'
import { fortnightlyCents, FORTNIGHTS_PER_YEAR } from '@nest/plan'
import { FY2027_CONFIG } from '@nest/tax'
import { estimateHouseholdTaxFromRows, type InflowRow } from './tax.ts'
import { type BudgetSummaryBundle, summariseHouseholdFromRows } from './summary.ts'

/** `2026-12-01` sits inside FY2027, which has a published config. */
const NOW = new Date('2026-12-01T00:00:00Z')

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

function bundle(overrides: Partial<BudgetSummaryBundle> = {}): BudgetSummaryBundle {
  return {
    inflows: [inflow()],
    taxProfiles: [{ member_id: 'm1', residency: 'resident', has_private_hospital_cover: false }],
    contributions: [],
    helpDebts: [],
    deductions: [],
    members: [{ id: 'm1', date_of_birth: null }],
    budgetLines: [],
    temporaryItems: [],
    savingsGoals: [],
    savers: [],
    breakdowns: [],
    breakdownItems: [],
    giftBudgets: [],
    giftRecipients: [],
    giftDiscretionaryBudget: null,
    ...overrides,
  }
}

Deno.test('summariseHouseholdFromRows: an always-on salary divides evenly, fortnightly matching annual', () => {
  const summary = summariseHouseholdFromRows(bundle(), NOW)
  const estimate = estimateHouseholdTaxFromRows(bundle(), FY2027_CONFIG)
  assertEquals(summary.available.annualCents, estimate.annualAfterTaxCents)
  assertEquals(
    summary.available.fortnightlyCents,
    Math.round(estimate.annualAfterTaxCents / FORTNIGHTS_PER_YEAR),
  )
})

Deno.test('summariseHouseholdFromRows: the buffer is available cash less every group total', () => {
  const lines = [
    {
      line_group: 'needs',
      amount_cents: 2_000_00,
      frequency: 'fortnightly',
      interval_count: null,
      is_gift_line: false,
      breakdown_id: null,
      gift_recipient_member_id: null,
    },
    {
      line_group: 'savings',
      amount_cents: 300_00,
      frequency: 'fortnightly',
      interval_count: null,
      is_gift_line: false,
      breakdown_id: null,
      gift_recipient_member_id: null,
    },
  ]
  const summary = summariseHouseholdFromRows(bundle({ budgetLines: lines }), NOW)
  const estimate = estimateHouseholdTaxFromRows(bundle(), FY2027_CONFIG)
  const available = Math.round(estimate.annualAfterTaxCents / FORTNIGHTS_PER_YEAR)
  assertEquals(summary.afterSaving.fortnightlyCents, available - 2_000_00 - 300_00)
})

Deno.test('summariseHouseholdFromRows: a salary that ended before now feeds the fortnightly buffer nothing', () => {
  const needs = {
    line_group: 'needs',
    amount_cents: 100_00,
    frequency: 'fortnightly',
    interval_count: null,
    is_gift_line: false,
    breakdown_id: null,
    gift_recipient_member_id: null,
  }
  const ended = inflow({ ends_on: '2026-09-30' })
  const summary = summariseHouseholdFromRows(
    bundle({ inflows: [ended], budgetLines: [needs] }),
    NOW,
  )
  assertEquals(summary.available.fortnightlyCents, 0)
  assert(summary.afterSaving.fortnightlyCents < 0)
  // The annual side still reflects the part-year the salary was active.
  assertEquals(
    summary.available.annualCents,
    estimateHouseholdTaxFromRows(bundle({ inflows: [ended] }), FY2027_CONFIG).annualAfterTaxCents,
  )
  assert(summary.available.annualCents > 0)
})

Deno.test("summariseHouseholdFromRows: a goal's projected interest is taxed and added to available", () => {
  const withInterest = bundle({
    savingsGoals: [{
      annual_interest_bps: 500,
      linked_account_id: null,
      current_balance_cents: 200_000_00,
    }],
  })
  const plain = summariseHouseholdFromRows(bundle(), NOW)
  const taxed = summariseHouseholdFromRows(withInterest, NOW)
  // $10,000 of assessable interest raises income tax and lifts net available cash.
  assert(taxed.tax.annualCents > plain.tax.annualCents)
  assert(taxed.available.annualCents > plain.available.annualCents)
})

Deno.test('summariseHouseholdFromRows: a breakdown-derived line rolls its items into outgoings', () => {
  const derivedLine = {
    line_group: 'needs',
    amount_cents: 0,
    frequency: 'monthly',
    interval_count: null,
    is_gift_line: false,
    breakdown_id: 'b1',
    gift_recipient_member_id: null,
  }
  const summary = summariseHouseholdFromRows(
    bundle({
      budgetLines: [derivedLine],
      breakdowns: [{ id: 'b1' }],
      breakdownItems: [
        { breakdown_id: 'b1', amount_cents: 20_00, frequency: 'monthly', interval_count: null },
      ],
    }),
    NOW,
  )
  // $20/month → $240/year of Needs, and nothing typed on the line itself.
  assertEquals(summary.groups.needs.annualCents, 20_00 * 12)
  assertEquals(
    summary.groups.needs.fortnightlyCents,
    fortnightlyCents(20_00 * 12, 'annual'),
  )
})

Deno.test('summariseHouseholdFromRows: the ad hoc gift buffer folds into the external gift line', () => {
  const externalGiftLine = {
    line_group: 'wants',
    amount_cents: 0,
    frequency: 'annual',
    interval_count: null,
    is_gift_line: true,
    breakdown_id: null,
    gift_recipient_member_id: null,
  }
  const summary = summariseHouseholdFromRows(
    bundle({
      budgetLines: [externalGiftLine],
      giftDiscretionaryBudget: { budgeted_amount_cents: 500_00 },
    }),
    NOW,
  )
  // The $500/year buffer is the whole of the external "Gifts (others)" line.
  assertEquals(summary.groups.wants.annualCents, 500_00)
})

Deno.test('summariseHouseholdFromRows: one-off money sits beside the plan, not in available', () => {
  const withBonus = bundle({
    inflows: [
      inflow(),
      inflow({
        type: 'other',
        schedule: null,
        amount_cents: 10_000_00,
        paid_on: '2026-09-01',
        attracts_super: false,
      }),
    ],
  })
  const summary = summariseHouseholdFromRows(withBonus, NOW)
  const estimate = estimateHouseholdTaxFromRows(withBonus, FY2027_CONFIG)
  assertEquals(summary.oneOffCents, 10_000_00)
  assertEquals(summariseHouseholdFromRows(bundle(), NOW).oneOffCents, 0)
  // Available cash is the estimate's after-tax NET of the one-off's own after-tax
  // value — the one-off is reported beside the plan, never inside it.
  assertEquals(
    summary.available.annualCents,
    estimate.annualAfterTaxCents - estimate.annualOneOffAfterTaxCents,
  )
})
