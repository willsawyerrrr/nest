import { assert, describe, expect, it } from 'vitest'
import { fortnightlyCents, FORTNIGHTS_PER_YEAR } from '@nest/plan'
import { FY2027_CONFIG } from '@nest/tax'
import type { BudgetLineRow, BudgetSummaryBundle, InflowRow } from './rows.ts'
import { summariseHouseholdFromRows, toSummaryInput } from './summary.ts'
import { estimateHouseholdTaxFromRows } from './tax.ts'

/** `2026-12-01` sits inside FY2027, which has a published config. */
const NOW = new Date('2026-12-01T00:00:00Z')

function inflow(overrides: Partial<InflowRow> = {}): InflowRow {
  return {
    member_id: 'm1',
    taxable: true,
    attracts_super: true,
    type: 'salary',
    schedule: 'annual',
    interval_count: null,
    amount_cents: 120_000_00,
    hourly_rate_cents: null,
    hours_per_period: null,
    starts_on: null,
    ends_on: null,
    paid_on: null,
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
    ...overrides,
  }
}

function line(overrides: Partial<BudgetLineRow> = {}): BudgetLineRow {
  return {
    line_group: 'needs',
    amount_cents: 100_00,
    frequency: 'fortnightly',
    interval_count: null,
    ...overrides,
  }
}

const summaryInputArgs = {
  afterTaxIncomeAnnualCents: 0,
  financialYear: 2027,
  inflows: [] as InflowRow[],
  budgetLines: [] as BudgetLineRow[],
  temporaryItems: [],
}

describe('toSummaryInput', () => {
  it('passes the after-tax income through unchanged', () => {
    expect(
      toSummaryInput({ ...summaryInputArgs, afterTaxIncomeAnnualCents: 80_000_00 })
        .afterTaxIncomeAnnualCents,
    ).toBe(80_000_00)
  })

  it('passes the gross-basis tax and salary-sacrifice annuals through', () => {
    const result = toSummaryInput({
      ...summaryInputArgs,
      taxAnnualCents: 39_000_00,
      salarySacrificeAnnualCents: 13_000_00,
    })
    expect(result.taxAnnualCents).toBe(39_000_00)
    expect(result.salarySacrificeAnnualCents).toBe(13_000_00)
  })

  it('defaults the gross-basis tax and salary-sacrifice annuals to zero when omitted', () => {
    const result = toSummaryInput(summaryInputArgs)
    expect(result.taxAnnualCents).toBe(0)
    expect(result.salarySacrificeAnnualCents).toBe(0)
  })

  it('keeps only non-taxable inflows, mapping schedule and interval', () => {
    const result = toSummaryInput({
      ...summaryInputArgs,
      inflows: [
        inflow({ taxable: true }),
        inflow({
          taxable: false,
          amount_cents: 40_00,
          schedule: 'every_n_weeks',
          interval_count: 3,
        }),
      ],
    })
    expect(result.nonTaxableInflows).toEqual([
      { amountCents: 40_00, frequency: 'every_n_weeks', interval: 3 },
    ])
  })

  it('maps a non-taxable inflow’s effective window onto startsOn / endsOn', () => {
    const result = toSummaryInput({
      ...summaryInputArgs,
      inflows: [
        inflow({
          taxable: false,
          amount_cents: 200_00,
          schedule: 'fortnightly',
          starts_on: '2026-08-01',
          ends_on: '2027-01-31',
        }),
      ],
    })
    expect(result.nonTaxableInflows).toEqual([
      {
        amountCents: 200_00,
        frequency: 'fortnightly',
        startsOn: '2026-08-01',
        endsOn: '2027-01-31',
      },
    ])
  })

  it('omits startsOn / endsOn and defaults a missing amount to zero cents', () => {
    const result = toSummaryInput({
      ...summaryInputArgs,
      inflows: [
        inflow({ taxable: false, amount_cents: null, schedule: 'weekly', interval_count: null }),
      ],
    })
    expect(result.nonTaxableInflows[0]).toEqual({
      amountCents: 0,
      frequency: 'weekly',
      interval: undefined,
    })
  })

  it('drops a non-taxable inflow that states no cadence', () => {
    const result = toSummaryInput({
      ...summaryInputArgs,
      inflows: [
        inflow({ taxable: false, schedule: null, paid_on: '2026-09-12', amount_cents: 500_00 }),
      ],
    })
    expect(result.nonTaxableInflows).toEqual([])
  })

  it('maps a manual budget line untouched, carrying a custom cadence interval', () => {
    const result = toSummaryInput({
      ...summaryInputArgs,
      budgetLines: [
        line({ line_group: 'needs', amount_cents: 42_00, frequency: 'weekly' }),
        line({
          line_group: 'wants',
          amount_cents: 60_00,
          frequency: 'every_n_months',
          interval_count: 4,
        }),
      ],
    })
    expect(result.budgetLines).toEqual([
      { group: 'needs', amountCents: 42_00, frequency: 'weekly', interval: undefined },
      { group: 'wants', amountCents: 60_00, frequency: 'every_n_months', interval: 4 },
    ])
  })

  it('reports one-off money landing in the year and keeps it out of the inflow top-up', () => {
    const result = toSummaryInput({
      ...summaryInputArgs,
      inflows: [
        inflow({ taxable: false, schedule: null, paid_on: '2026-09-12', amount_cents: 5_000_00 }),
        inflow({ taxable: true, schedule: null, paid_on: '2027-01-05', amount_cents: 40_000_00 }),
        inflow({ taxable: false, schedule: 'weekly', amount_cents: 100_00 }),
        inflow({ taxable: true, schedule: null, paid_on: '2028-01-05', amount_cents: 9_000_00 }),
        inflow({ taxable: true, schedule: null, paid_on: '2027-02-01', amount_cents: null }),
      ],
    })
    expect(result.oneOffCents).toBe(45_000_00)
    expect(result.nonTaxableInflows).toEqual([
      { amountCents: 100_00, frequency: 'weekly', interval: undefined },
    ])
  })

  it('maps temporary items to their contribution and target date', () => {
    const result = toSummaryInput({
      ...summaryInputArgs,
      temporaryItems: [{ contribution_cents: 25_00, target_date: '2031-06-30' }],
    })
    expect(result.temporaryItems).toEqual([{ contributionCents: 25_00, targetDate: '2031-06-30' }])
  })
})

describe('summariseHouseholdFromRows', () => {
  it('divides an always-on salary evenly, fortnightly matching annual', () => {
    const summary = summariseHouseholdFromRows(bundle(), NOW)
    const estimate = estimateHouseholdTaxFromRows(
      bundle().inflows,
      bundle().taxProfiles,
      bundle().contributions,
      bundle().helpDebts,
      bundle().deductions,
      FY2027_CONFIG,
      undefined,
      bundle().members,
    )
    expect(summary.available.annualCents).toBe(estimate.annualAfterTaxCents)
    expect(summary.available.fortnightlyCents).toBe(
      Math.round(estimate.annualAfterTaxCents / FORTNIGHTS_PER_YEAR),
    )
  })

  it('is available cash less every group total', () => {
    const summary = summariseHouseholdFromRows(
      bundle({
        budgetLines: [
          line({ line_group: 'needs', amount_cents: 2_000_00 }),
          line({ line_group: 'savings', amount_cents: 300_00 }),
        ],
      }),
      NOW,
    )
    const estimate = summariseHouseholdFromRows(bundle(), NOW)
    expect(summary.afterSaving.fortnightlyCents).toBe(
      estimate.available.fortnightlyCents - 2_000_00 - 300_00,
    )
  })

  it('feeds the fortnightly buffer nothing for a salary that ended before now', () => {
    const ended = inflow({ ends_on: '2026-09-30' })
    const summary = summariseHouseholdFromRows(
      bundle({ inflows: [ended], budgetLines: [line({ amount_cents: 100_00 })] }),
      NOW,
    )
    expect(summary.available.fortnightlyCents).toBe(0)
    assert(summary.afterSaving.fortnightlyCents < 0)
    assert(summary.available.annualCents > 0)
  })

  it("adds a goal's projected interest to available cash and its tax", () => {
    const withInterest = bundle({
      savingsGoals: [
        { annual_interest_bps: 500, linked_account_id: null, current_balance_cents: 200_000_00 },
      ],
    })
    const plain = summariseHouseholdFromRows(bundle(), NOW)
    const taxed = summariseHouseholdFromRows(withInterest, NOW)
    assert(taxed.tax.annualCents > plain.tax.annualCents)
    assert(taxed.available.annualCents > plain.available.annualCents)
  })

  it('reads a derived line at its canonical annual amount, not re-rolled', () => {
    const summary = summariseHouseholdFromRows(
      bundle({
        budgetLines: [
          line({ line_group: 'needs', amount_cents: 240_00, frequency: 'annual' }),
          line({ line_group: 'wants', amount_cents: 500_00, frequency: 'annual' }),
        ],
      }),
      NOW,
    )
    expect(summary.groups.needs.annualCents).toBe(240_00)
    expect(summary.groups.needs.fortnightlyCents).toBe(fortnightlyCents(240_00, 'annual'))
    expect(summary.groups.wants.annualCents).toBe(500_00)
  })

  it('sits one-off money beside the plan, not in available', () => {
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
    expect(summary.oneOffCents).toBe(10_000_00)
    expect(summariseHouseholdFromRows(bundle(), NOW).oneOffCents).toBe(0)
    assert(summary.available.annualCents > 0)
  })

  it('falls back to the FY2027 config for a date whose financial year has none', () => {
    const summary = summariseHouseholdFromRows(bundle(), new Date('2099-12-01T00:00:00Z'))
    const asFy2027 = summariseHouseholdFromRows(bundle(), NOW)
    expect(summary.available.annualCents).toBe(asFy2027.available.annualCents)
  })
})
