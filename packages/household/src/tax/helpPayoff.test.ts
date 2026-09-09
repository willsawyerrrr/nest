import { describe, expect, it } from 'vitest'
import { FY2027_CONFIG, type TaxBreakdown } from '@nest/tax'
import type { HelpDebtRow, InflowRow, TaxProfileRow } from '../rows.ts'
import {
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  helpPayoffForBreakdown,
  helpPayoffSummary,
} from '../tax.ts'

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

const breakdownWithRepaymentIncome = (repaymentIncomeCents: number): TaxBreakdown => ({
  taxableIncomeCents: repaymentIncomeCents,
  incomeForSurchargeCents: repaymentIncomeCents,
  incomeTaxCents: 0,
  litoOffsetCents: 0,
  oneOffOffsetCents: 0,
  medicareLevyCents: 0,
  medicareLevySurchargeCents: 0,
  helpRepaymentCents: 0,
  division293Cents: 0,
  totalLiabilityCents: 0,
  paygWithheldCents: 0,
  balanceCents: 0,
  repaymentIncomeCents,
})

describe('helpPayoffForBreakdown', () => {
  it('projects payoff from the financial year of `now`, holding repayment income constant', () => {
    const projection = helpPayoffForBreakdown(
      breakdownWithRepaymentIncome(90_000_00),
      2_000_00,
      FY2027_CONFIG,
      new Date('2026-09-15T00:00:00Z'),
    )
    expect(projection.paidOffFinancialYear).toBe(2027)
    expect(projection.yearsToPayOff).toBe(1)
  })
})

describe('helpPayoffSummary', () => {
  it('summarises a clearing projection with its year and years-to-go', () => {
    expect(helpPayoffSummary({ paidOffFinancialYear: 2032, yearsToPayOff: 6, schedule: [] })).toBe(
      'HELP debt projected paid off in FY2032 (6 years)',
    )
    expect(helpPayoffSummary({ paidOffFinancialYear: 2027, yearsToPayOff: 1, schedule: [] })).toBe(
      'HELP debt projected paid off in FY2027 (1 year)',
    )
  })

  it('treats a missing years-to-go as zero', () => {
    expect(
      helpPayoffSummary({ paidOffFinancialYear: 2027, yearsToPayOff: null, schedule: [] }),
    ).toBe('HELP debt projected paid off in FY2027 (0 years)')
  })

  it('summarises a projection that does not clear within the horizon', () => {
    expect(
      helpPayoffSummary({ paidOffFinancialYear: null, yearsToPayOff: null, schedule: [] }),
    ).toBe('HELP debt not cleared within 40 years at current income')
  })
})

describe('helpPayoffByMember', () => {
  it('projects only members with a positive HELP balance', () => {
    const highSalary = inflow({
      schedule: 'annual',
      interval_count: null,
      amount_cents: 100_000_00,
    })
    const helpDebt: HelpDebtRow = { member_id: 'm1', balance_cents: 30_000_00 }
    const estimate = estimateHouseholdTaxFromRows([highSalary], [profile], [], [helpDebt])
    const byMember = helpPayoffByMember(estimate, [helpDebt], FY2027_CONFIG)
    expect(byMember.has('m1')).toBe(true)
    const projection = byMember.get('m1')!
    expect(projection.yearsToPayOff).toBe(8)
    expect(projection.paidOffFinancialYear).toBe(2034)
    expect(projection.schedule).toHaveLength(8)
    expect(projection.schedule.at(-1)?.closingBalanceCents).toBe(0)

    expect(helpPayoffByMember(estimate, [], FY2027_CONFIG).size).toBe(0)
  })
})
