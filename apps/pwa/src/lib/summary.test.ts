import { describe, expect, it } from 'vitest'
import { estimateHouseholdTaxFromRows } from '@nest/household'
import { fortnightlyCents, FORTNIGHTS_PER_YEAR } from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Inflow } from '../hooks/useInflows'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import type { DerivedAmountContext } from './breakdowns'
import { summariseHousehold } from './summary'

function context(overrides: Partial<DerivedAmountContext> = {}): DerivedAmountContext {
  return {
    genericTotalsByBreakdownId: new Map(),
    giftTotalsByMember: new Map(),
    ...overrides,
  }
}

function inflow(overrides: Partial<Inflow> = {}): Inflow {
  return {
    id: 'i1',
    household_id: 'h',
    name: 'Inflow',
    taxable: true,
    attracts_super: true,
    member_id: null,
    type: 'other',
    schedule: 'weekly',
    interval_count: null,
    pay_schedule: null,
    pay_interval_count: null,
    arrives_every_pay_period: true,
    amount_cents: 100_00,
    hourly_rate_cents: null,
    hours_per_period: null,
    starts_on: null,
    ends_on: null,
    pay_anchor_date: null,
    paid_on: null,
    one_off_tax_treatment: null,
    years_of_service: null,
    is_joint: false,
    member_split_percent: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function taxProfile(overrides: Partial<TaxProfile> = {}): TaxProfile {
  return {
    id: 'p1',
    household_id: 'h',
    member_id: 'm1',
    financial_year: 2027,
    residency: 'resident',
    has_private_hospital_cover: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: 'l1',
    household_id: 'h',
    line_group: 'wants',
    name: 'Line',
    amount_cents: 10_00,
    frequency: 'monthly',
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

const now = new Date('2026-12-01T00:00:00Z')

const sources = (inflows: Inflow[], budgetLines: BudgetLine[] = []) => ({
  inflows,
  budgetLines,
  taxProfiles: [taxProfile()],
  contributions: [],
  helpDebts: [],
  deductions: [],
  members: [],
  goals: [],
  accounts: [],
  derivedAmounts: context(),
  temporaryItems: [],
  now,
})

const salary = (overrides: Partial<Inflow> = {}): Inflow =>
  inflow({
    id: 'salary',
    member_id: 'm1',
    type: 'salary',
    schedule: 'annual',
    amount_cents: 120_000_00,
    ...overrides,
  })

describe('summariseHousehold — active-now fortnightly basis', () => {
  it('divides an always-on salary’s after-tax evenly, fortnightly matching annual', () => {
    const summary = summariseHousehold(sources([salary()]))
    const whole = estimateHouseholdTaxFromRows([salary()], [taxProfile()])
    expect(summary.available.annualCents).toBe(whole.annualAfterTaxCents)
    expect(summary.available.fortnightlyCents).toBe(
      Math.round(whole.annualAfterTaxCents / FORTNIGHTS_PER_YEAR),
    )
  })

  it('contributes nothing to the fortnightly buffer for a salary that ended before now', () => {
    const ended = salary({ ends_on: '2026-09-30' })
    const summary = summariseHousehold(sources([ended], [line({ line_group: 'needs' })]))
    expect(summary.available.fortnightlyCents).toBe(0)
    expect(summary.afterSaving.fortnightlyCents).toBeLessThan(0)
    expect(summary.tax.fortnightlyCents).toBe(0)
    expect(summary.available.annualCents).toBe(
      estimateHouseholdTaxFromRows([ended], [taxProfile()]).annualAfterTaxCents,
    )
    expect(summary.available.annualCents).toBeGreaterThan(0)
    expect(summary.groups.needs.portion).toBe(0)
    expect(summary.groups.needs.annualCents).toBe(120_00)
  })

  it('contributes nothing to the fortnightly buffer for a salary that starts after now', () => {
    const future = salary({ starts_on: '2027-03-01' })
    const summary = summariseHousehold(sources([future]))
    expect(summary.available.fortnightlyCents).toBe(0)
    expect(summary.available.annualCents).toBe(
      estimateHouseholdTaxFromRows([future], [taxProfile()]).annualAfterTaxCents,
    )
  })

  it('reads a mid-year switch at the rate active now, annual staying the blended whole-year figure', () => {
    const oldRate = salary({ id: 'old', amount_cents: 90_000_00, ends_on: '2026-09-14' })
    const newRate = salary({ id: 'new', amount_cents: 120_000_00, starts_on: '2026-09-15' })
    const summary = summariseHousehold(sources([oldRate, newRate]))

    const activeNowOnly = estimateHouseholdTaxFromRows(
      [salary({ id: 'new', amount_cents: 120_000_00 })],
      [taxProfile()],
    )
    expect(summary.available.fortnightlyCents).toBe(
      Math.round(activeNowOnly.annualAfterTaxCents / FORTNIGHTS_PER_YEAR),
    )
    const wholeYear = estimateHouseholdTaxFromRows([oldRate, newRate], [taxProfile()])
    expect(summary.available.annualCents).toBe(wholeYear.annualAfterTaxCents)
    expect(summary.available.annualCents).toBeLessThan(activeNowOnly.annualAfterTaxCents)
  })
})

describe('summariseHousehold — derived budget lines', () => {
  it('resolves a breakdown-derived line to its rolled-up annual total before reconciling', () => {
    const derived = line({ line_group: 'needs', breakdown_id: 'b1', amount_cents: 0 })
    const summary = summariseHousehold({
      ...sources([salary()], [derived]),
      derivedAmounts: context({ genericTotalsByBreakdownId: new Map([['b1', 240_00]]) }),
    })
    expect(summary.groups.needs.annualCents).toBe(240_00)
    expect(summary.groups.needs.fortnightlyCents).toBe(fortnightlyCents(240_00, 'annual'))
  })

  it('partitions a gift line to its recipient’s share', () => {
    const giftLine = line({
      line_group: 'wants',
      is_gift_line: true,
      gift_recipient_member_id: null,
      amount_cents: 0,
    })
    const summary = summariseHousehold({
      ...sources([salary()], [giftLine]),
      derivedAmounts: context({ giftTotalsByMember: new Map([[null, 500_00]]) }),
    })
    expect(summary.groups.wants.annualCents).toBe(500_00)
  })
})
