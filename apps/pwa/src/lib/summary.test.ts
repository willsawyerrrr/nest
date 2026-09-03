import { describe, expect, it } from 'vitest'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Inflow } from '../hooks/useInflows'
import type { TemporaryItem } from '../hooks/useTemporaryItems'
import type { DerivedAmountContext } from './breakdowns'
import { toSummaryInput } from './summary'

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
    paid_on: null,
    one_off_tax_treatment: null,
    years_of_service: null,
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

function temporaryItem(overrides: Partial<TemporaryItem> = {}): TemporaryItem {
  return {
    id: 't1',
    household_id: 'h',
    name: 'Item',
    contribution_cents: 5_00,
    target_date: '2030-01-01',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('toSummaryInput', () => {
  it('passes the after-tax income through unchanged', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 80_000_00,
      inflows: [],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.afterTaxIncomeAnnualCents).toBe(80_000_00)
  })

  it('passes the gross-basis tax and salary-sacrifice annuals through', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
      taxAnnualCents: 39_000_00,
      salarySacrificeAnnualCents: 13_000_00,
    })
    expect(result.taxAnnualCents).toBe(39_000_00)
    expect(result.salarySacrificeAnnualCents).toBe(13_000_00)
  })

  it('defaults the gross-basis tax and salary-sacrifice annuals to zero when omitted', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.taxAnnualCents).toBe(0)
    expect(result.salarySacrificeAnnualCents).toBe(0)
  })

  it('keeps only non-taxable inflows, mapping schedule and interval', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [
        inflow({ id: 'taxable', taxable: true }),
        inflow({
          id: 'gift',
          taxable: false,
          amount_cents: 40_00,
          schedule: 'every_n_weeks',
          interval_count: 3,
        }),
      ],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.nonTaxableInflows).toEqual([
      { amountCents: 40_00, frequency: 'every_n_weeks', interval: 3 },
    ])
  })

  it('maps a non-taxable inflow’s effective window onto startsOn / endsOn', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [
        inflow({
          taxable: false,
          amount_cents: 200_00,
          schedule: 'fortnightly',
          starts_on: '2026-08-01',
          ends_on: '2027-01-31',
        }),
      ],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
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

  it('omits startsOn / endsOn for a non-taxable inflow with no effective dates', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [inflow({ taxable: false, amount_cents: 200_00, schedule: 'fortnightly' })],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.nonTaxableInflows[0]).not.toHaveProperty('startsOn')
    expect(result.nonTaxableInflows[0]).not.toHaveProperty('endsOn')
  })

  it('defaults a non-taxable inflow with no amount to zero cents', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [inflow({ taxable: false, amount_cents: null, interval_count: null })],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.nonTaxableInflows[0]).toEqual({
      amountCents: 0,
      frequency: 'weekly',
      interval: undefined,
    })
  })

  it('substitutes a derived line’s breakdown total as an annual amount', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [],
      budgetLines: [line({ id: 'd', breakdown_id: 'b1', amount_cents: 0, frequency: 'monthly' })],
      derivedAmounts: context({ genericTotalsByBreakdownId: new Map([['b1', 150_00]]) }),
      temporaryItems: [],
    })
    expect(result.budgetLines).toEqual([
      { group: 'wants', amountCents: 150_00, frequency: 'annual', interval: undefined },
    ])
  })

  it('maps a manual budget line untouched', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [],
      budgetLines: [line({ line_group: 'needs', amount_cents: 42_00, frequency: 'weekly' })],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.budgetLines).toEqual([
      { group: 'needs', amountCents: 42_00, frequency: 'weekly', interval: undefined },
    ])
  })

  it('carries a budget line’s custom cadence interval through', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [],
      budgetLines: [line({ amount_cents: 60_00, frequency: 'every_n_months', interval_count: 4 })],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.budgetLines).toEqual([
      { group: 'wants', amountCents: 60_00, frequency: 'every_n_months', interval: 4 },
    ])
  })

  it('reports one-off money landing in the year, and keeps it out of the inflow top-up', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [
        inflow({
          id: 'i1',
          taxable: false,
          schedule: null,
          paid_on: '2026-09-12',
          amount_cents: 5_000_00,
        }),
        inflow({
          id: 'i2',
          taxable: true,
          schedule: null,
          paid_on: '2027-01-05',
          amount_cents: 40_000_00,
        }),
        inflow({ id: 'i3', taxable: false, schedule: 'weekly', amount_cents: 100_00 }),
      ],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.oneOffCents).toBe(45_000_00)
    // Only the recurring non-taxable inflow tops up available cash.
    expect(result.nonTaxableInflows).toEqual([
      { amountCents: 100_00, frequency: 'weekly', interval: undefined },
    ])
  })

  it('leaves a one-off landing in another financial year to that year', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [inflow({ schedule: null, paid_on: '2027-09-12', amount_cents: 5_000_00 })],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.oneOffCents).toBe(0)
  })

  it('counts a one-off with no amount entered as nothing', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [inflow({ schedule: null, paid_on: '2026-09-12', amount_cents: null })],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [],
    })
    expect(result.oneOffCents).toBe(0)
  })

  it('maps temporary items to their contribution and target date', () => {
    const result = toSummaryInput({
      financialYear: 2027,
      afterTaxIncomeAnnualCents: 0,
      inflows: [],
      budgetLines: [],
      derivedAmounts: context(),
      temporaryItems: [temporaryItem({ contribution_cents: 25_00, target_date: '2031-06-30' })],
    })
    expect(result.temporaryItems).toEqual([{ contributionCents: 25_00, targetDate: '2031-06-30' }])
  })
})
