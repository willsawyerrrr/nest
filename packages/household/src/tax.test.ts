import { afterEach, describe, expect, it, vi } from 'vitest'
import { fortnightlyCents } from '@nest/plan'
import { annualGrossCents, FY2027_CONFIG, type TaxBreakdown } from '@nest/tax'
import type {
  DeductionRow,
  HelpDebtRow,
  InflowRow,
  InterestGoalRow,
  SaverRow,
  SuperContributionRow,
  SuperProfileRow,
  TaxProfileRow,
} from './rows.ts'
import {
  activeNowTaxableInflows,
  atPreservationAgeOn,
  concessionalByMember,
  currentTaxConfig,
  deductionsByMember,
  ENGINE_ONE_OFF_TREATMENTS,
  estimateHouseholdTaxFromRows,
  helpDebtCentsByMember,
  helpPayoffByMember,
  helpPayoffForBreakdown,
  helpPayoffSummary,
  inflowIncomeInputs,
  netAnnualSuperContributionByMember,
  netAnnualSuperContributionFromRows,
  nonConcessionalByMember,
  projectedInterestIncomeInputs,
  splitAcrossMembers,
  splitByPercent,
  superCapSummaryByMember,
  superCapSummaryFromRows,
  toIncomeInput,
} from './tax.ts'

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

const baseProfile: SuperProfileRow = { member_id: 'm1', carry_forward_cap_cents: 0 }

function contribution(overrides: Partial<SuperContributionRow> = {}): SuperContributionRow {
  return {
    member_id: 'm1',
    kind: 'salary_sacrifice',
    mode: 'amount',
    amount_cents: 500_00,
    percent_bp: null,
    frequency: 'fortnightly',
    interval_count: null,
    ...overrides,
  }
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

describe('currentTaxConfig', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('selects the versioned config for a date inside its financial year', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T00:00:00Z'))
    const config = currentTaxConfig()
    expect(config.financialYear).toBe(2027)
    expect(config).toBe(FY2027_CONFIG)
  })

  it('falls back to FY2027 for a date whose financial year has no config', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2050-01-01T00:00:00Z'))
    const config = currentTaxConfig()
    expect(config.financialYear).toBe(2027)
    expect(config).toBe(FY2027_CONFIG)
  })
})

describe('concessionalByMember', () => {
  it('annualises an amount-mode concessional contribution by frequency', () => {
    expect(concessionalByMember([contribution()], new Map()).get('m1')).toBe(13_000_00)
  })

  it('resolves a percent-mode contribution against the member gross salary', () => {
    const percentRow = contribution({
      kind: 'personal_deductible',
      mode: 'percent',
      amount_cents: null,
      percent_bp: 1000,
      frequency: 'annual',
    })
    expect(concessionalByMember([percentRow], new Map([['m1', 100_000_00]])).get('m1')).toBe(
      10_000_00,
    )
  })

  it('sums concessional kinds and excludes non-concessional and spouse contributions', () => {
    const rows: SuperContributionRow[] = [
      contribution(),
      contribution({ kind: 'personal_deductible', frequency: 'annual' }),
      contribution({ kind: 'personal_non_concessional', frequency: 'annual' }),
      contribution({ kind: 'spouse' }),
    ]
    expect(concessionalByMember(rows, new Map()).get('m1')).toBe(13_000_00 + 500_00)
  })

  it('yields zero for a percent-mode contribution with no rate against an unknown member gross', () => {
    const percentRow = contribution({
      mode: 'percent',
      amount_cents: null,
      percent_bp: null,
      frequency: 'annual',
    })
    expect(concessionalByMember([percentRow], new Map()).get('m1')).toBe(0)
  })

  it('yields zero for an amount-mode contribution with no amount', () => {
    const amountRow = contribution({ mode: 'amount', amount_cents: null, frequency: 'annual' })
    expect(concessionalByMember([amountRow], new Map()).get('m1')).toBe(0)
  })
})

describe('estimateHouseholdTaxFromRows', () => {
  it('reduces taxable income by concessional contributions', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 100_000_00 })
    const withSuper = estimateHouseholdTaxFromRows(
      [salary],
      [profile],
      [contribution({ frequency: 'annual', amount_cents: 15_000_00 })],
    )
    const withoutSuper = estimateHouseholdTaxFromRows([salary], [profile], [])
    expect(withSuper.members[0]!.annualConcessionalContributionsCents).toBe(15_000_00)
    expect(withSuper.members[0]!.annualTaxCents).toBeLessThan(
      withoutSuper.members[0]!.annualTaxCents,
    )
  })

  it('maps a foreign-resident profile through the estimate', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 100_000_00 })
    const estimate = estimateHouseholdTaxFromRows(
      [salary],
      [{ ...profile, residency: 'foreign_resident' }],
    )
    expect(estimate.members).toHaveLength(1)
    expect(estimate.annualGrossCents).toBe(100_000_00)
  })

  const highSalary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 100_000_00 })

  it('threads a member HELP balance from the help-debt rows into the estimate', () => {
    const helpDebt: HelpDebtRow = { member_id: 'm1', balance_cents: 30_000_00 }
    const withHelp = estimateHouseholdTaxFromRows([highSalary], [profile], [], [helpDebt])
    const withoutHelp = estimateHouseholdTaxFromRows([highSalary], [profile], [], [])
    expect(withHelp.members[0]!.breakdown.helpRepaymentCents).toBeGreaterThan(0)
    expect(withoutHelp.members[0]!.breakdown.helpRepaymentCents).toBe(0)
  })

  it('assesses a HELP balance for a member with no tax profile', () => {
    const estimate = estimateHouseholdTaxFromRows(
      [highSalary],
      [],
      [],
      [{ member_id: 'm1', balance_cents: 30_000_00 }],
    )
    expect(estimate.members[0]!.breakdown.helpRepaymentCents).toBeGreaterThan(0)
  })

  it('ignores a zero HELP balance for a member with no tax profile', () => {
    const estimate = estimateHouseholdTaxFromRows(
      [highSalary],
      [],
      [],
      [{ member_id: 'm1', balance_cents: 0 }],
    )
    expect(estimate.members[0]!.breakdown.helpRepaymentCents).toBe(0)
  })

  it('annualises an every-N-weeks taxable inflow via the shared normalization', () => {
    expect(estimateHouseholdTaxFromRows([inflow()], [profile]).annualGrossCents).toBe(3_900_00)
  })

  it('matches the fortnightly case when the interval is 2 weeks', () => {
    const everyTwoWeeks = estimateHouseholdTaxFromRows(
      [inflow({ schedule: 'every_n_weeks', interval_count: 2 })],
      [profile],
    )
    const fortnightly = estimateHouseholdTaxFromRows(
      [inflow({ schedule: 'fortnightly', interval_count: null })],
      [profile],
    )
    expect(everyTwoWeeks.annualGrossCents).toBe(fortnightly.annualGrossCents)
    expect(everyTwoWeeks.annualTaxCents).toBe(fortnightly.annualTaxCents)
  })
})

describe('estimateHouseholdTaxFromRows for pay arriving in only some periods', () => {
  const onCall = inflow({
    type: 'other',
    schedule: 'annual',
    interval_count: null,
    amount_cents: 6_600_00,
    attracts_super: false,
  })

  it('counts the whole year’s projection either way', () => {
    const estimate = estimateHouseholdTaxFromRows([onCall], [profile])
    expect(estimate.annualGrossCents).toBe(6_600_00)
  })

  it('keeps the super bases and the co-contribution income test unchanged', () => {
    const summary = superCapSummaryFromRows(
      [inflow({ schedule: 'annual', interval_count: null, amount_cents: 90_000_00 }), onCall],
      [baseProfile],
      [],
    ).get('m1')!
    expect(summary.coContributionCents).toBe(0)
  })

  it('normalises to the same fortnightly and annual figures the plan reads', () => {
    const annual = annualGrossCents(toIncomeInput(onCall))
    expect(annual).toBe(6_600_00)
    expect(fortnightlyCents(annual, 'annual')).toBe(253_85)
  })
})

describe('estimateHouseholdTaxFromRows effective dates', () => {
  const oldRate = inflow({
    schedule: 'annual',
    interval_count: null,
    amount_cents: 90_000_00,
    ends_on: '2026-09-14',
  })
  const newRate = inflow({
    schedule: 'annual',
    interval_count: null,
    amount_cents: 100_000_00,
    starts_on: '2026-09-15',
  })

  it('prorates a mid-year pay rise across the two dated rates by calendar days', () => {
    const expected = Math.round((90_000_00 * 76) / 365) + Math.round((100_000_00 * 289) / 365)
    const estimate = estimateHouseholdTaxFromRows([oldRate, newRate], [profile])
    expect(estimate.annualGrossCents).toBe(expected)
    expect(estimate.annualGrossCents).toBeGreaterThan(90_000_00)
    expect(estimate.annualGrossCents).toBeLessThan(100_000_00)
  })

  it('leaves undated income at its full steady-rate gross', () => {
    const undated = inflow({ schedule: 'annual', interval_count: null, amount_cents: 90_000_00 })
    expect(estimateHouseholdTaxFromRows([undated], [profile]).annualGrossCents).toBe(90_000_00)
  })
})

describe('activeNowTaxableInflows', () => {
  const now = new Date('2026-12-01T00:00:00Z')
  const recurring = inflow({ schedule: 'annual', interval_count: null })

  it('keeps an active recurring inflow with its effective dates cleared', () => {
    const dated = { ...recurring, starts_on: '2026-07-01', ends_on: '2027-06-30' }
    expect(activeNowTaxableInflows([dated], now)).toEqual([
      { ...dated, starts_on: null, ends_on: null },
    ])
  })

  it('keeps an open-ended recurring inflow untouched aside from the (already null) dates', () => {
    expect(activeNowTaxableInflows([recurring], now)).toEqual([recurring])
  })

  it('drops a recurring inflow that ended before now', () => {
    expect(activeNowTaxableInflows([{ ...recurring, ends_on: '2026-09-30' }], now)).toEqual([])
  })

  it('drops a recurring inflow that starts after now', () => {
    expect(activeNowTaxableInflows([{ ...recurring, starts_on: '2027-03-01' }], now)).toEqual([])
  })

  it('passes a one-off through unchanged, dates and all', () => {
    const oneOff = inflow({ schedule: null, interval_count: null, paid_on: '2026-08-15' })
    expect(activeNowTaxableInflows([oneOff], now)).toEqual([oneOff])
  })

  it('drops a non-taxable inflow', () => {
    expect(activeNowTaxableInflows([{ ...recurring, taxable: false }], now)).toEqual([])
  })
})

describe('deductionsByMember', () => {
  it('sums each member deduction amount by member id', () => {
    const result = deductionsByMember([
      { member_id: 'm1', amount_cents: 1_200_00 },
      { member_id: 'm1', amount_cents: 300_00 },
      { member_id: 'm2', amount_cents: 500_00 },
    ])
    expect(result.get('m1')).toBe(1_500_00)
    expect(result.get('m2')).toBe(500_00)
  })
})

describe('estimateHouseholdTaxFromRows deductions', () => {
  const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 100_000_00 })
  const deduction: DeductionRow = { member_id: 'm1', amount_cents: 10_000_00 }

  it('lowers tax when deductions are supplied', () => {
    const withDeduction = estimateHouseholdTaxFromRows([salary], [profile], [], [], [deduction])
    const withoutDeduction = estimateHouseholdTaxFromRows([salary], [profile], [], [], [])
    expect(withDeduction.members[0]!.annualDeductionsCents).toBe(10_000_00)
    expect(withDeduction.members[0]!.annualTaxCents).toBeLessThan(
      withoutDeduction.members[0]!.annualTaxCents,
    )
  })
})

describe('helpDebtCentsByMember', () => {
  it('keys each member HELP balance by member id', () => {
    const result = helpDebtCentsByMember([
      { member_id: 'm1', balance_cents: 30_000_00 },
      { member_id: 'm2', balance_cents: 5_000_00 },
    ])
    expect(result.get('m1')).toBe(30_000_00)
    expect(result.get('m2')).toBe(5_000_00)
  })
})

describe('nonConcessionalByMember', () => {
  const nonConcessional = contribution({ kind: 'personal_non_concessional' })

  it('annualises an amount-mode non-concessional contribution by frequency', () => {
    expect(nonConcessionalByMember([nonConcessional], new Map()).get('m1')).toBe(13_000_00)
  })

  it('resolves a percent-mode contribution against the member gross salary', () => {
    const percentRow = contribution({
      kind: 'personal_non_concessional',
      mode: 'percent',
      amount_cents: null,
      percent_bp: 500,
      frequency: 'annual',
    })
    expect(nonConcessionalByMember([percentRow], new Map([['m1', 100_000_00]])).get('m1')).toBe(
      5_000_00,
    )
  })

  it('excludes concessional and spouse contributions', () => {
    const rows: SuperContributionRow[] = [
      nonConcessional,
      contribution({ kind: 'salary_sacrifice' }),
      contribution({ kind: 'spouse' }),
    ]
    expect(nonConcessionalByMember(rows, new Map()).get('m1')).toBe(13_000_00)
  })
})

describe('superCapSummaryByMember', () => {
  it('flags concessional over the effective cap, including carry-forward', () => {
    const concessional = contribution({
      kind: 'salary_sacrifice',
      frequency: 'annual',
      amount_cents: 40_000_00,
    })
    const withCarry = superCapSummaryByMember(
      [concessional],
      [{ ...baseProfile, carry_forward_cap_cents: 10_000_00 }],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    ).get('m1')!
    expect(withCarry.concessionalCapCents).toBe(42_500_00)
    expect(withCarry.concessionalOverCap).toBe(false)

    const noCarry = superCapSummaryByMember(
      [concessional],
      [baseProfile],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    ).get('m1')!
    expect(noCarry.concessionalCapCents).toBe(32_500_00)
    expect(noCarry.concessionalOverCap).toBe(true)
  })

  it('flags non-concessional over the cap and reports the co-contribution', () => {
    const over = contribution({
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 140_000_00,
    })
    const summary = superCapSummaryByMember(
      [over],
      [baseProfile],
      new Map([['m1', 40_000_00]]),
      new Map([['m1', 40_000_00]]),
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.nonConcessionalCapCents).toBe(130_000_00)
    expect(summary.nonConcessionalOverCap).toBe(true)
    expect(summary.coContributionCents).toBe(500_00)
  })

  it('produces a zero-usage entry for a member with only a profile', () => {
    const summary = superCapSummaryByMember(
      [],
      [baseProfile],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.concessionalCents).toBe(0)
    expect(summary.nonConcessionalCents).toBe(0)
    expect(summary.coContributionCents).toBe(0)
  })

  it('applies the bare config cap to a contributing member who has no super profile', () => {
    const summaries = superCapSummaryByMember(
      [
        contribution({
          member_id: 'm2',
          kind: 'salary_sacrifice',
          frequency: 'annual',
          amount_cents: 5_000_00,
        }),
      ],
      [{ ...baseProfile, member_id: 'm1' }],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    )
    expect(summaries.get('m2')!.concessionalCapCents).toBe(32_500_00)
    expect(summaries.get('m2')!.concessionalCents).toBe(5_000_00)
  })

  it('tests the co-contribution against assessable income, not ordinary time earnings', () => {
    const summary = superCapSummaryByMember(
      [
        contribution({
          kind: 'personal_non_concessional',
          frequency: 'annual',
          amount_cents: 1_000_00,
        }),
      ],
      [baseProfile],
      new Map([['m1', 45_000_00]]),
      new Map([['m1', 57_000_00]]),
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.coContributionCents).toBe(243_10)
  })
})

describe('superCapSummaryFromRows', () => {
  it('derives the co-contribution income test from taxable inflows', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 49_293_00 })
    const summary = superCapSummaryFromRows(
      [salary],
      [baseProfile],
      [
        contribution({
          kind: 'personal_non_concessional',
          frequency: 'annual',
          amount_cents: 1_000_00,
        }),
      ],
    ).get('m1')!
    expect(summary.nonConcessionalCents).toBe(1_000_00)
    expect(summary.coContributionCents).toBe(500_00)
  })

  it('counts an allowance that earns no super toward the co-contribution income test', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 45_000_00 })
    const onCall = inflow({
      attracts_super: false,
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 12_000_00,
    })
    const summary = superCapSummaryFromRows(
      [salary, onCall],
      [baseProfile],
      [
        contribution({
          kind: 'personal_non_concessional',
          frequency: 'annual',
          amount_cents: 1_000_00,
        }),
      ],
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.coContributionCents).toBe(243_10)
  })
})

describe('netAnnualSuperContributionByMember', () => {
  it('taxes concessional and employer SG at 15% and adds after-tax amounts untaxed', () => {
    const grossByMember = new Map([['m1', 100_000_00]])
    const result = netAnnualSuperContributionByMember(
      [contribution()],
      grossByMember,
      grossByMember,
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(21_250_00)
  })

  it('adds non-concessional contributions and the co-contribution without taxing them', () => {
    const grossByMember = new Map([['m1', 49_293_00]])
    const sgAfterTax = Math.round(0.12 * 49_293_00 * 0.85)
    const result = netAnnualSuperContributionByMember(
      [
        contribution({
          kind: 'personal_non_concessional',
          frequency: 'annual',
          amount_cents: 1_000_00,
        }),
      ],
      grossByMember,
      grossByMember,
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(sgAfterTax + 1_000_00 + 500_00)
  })

  it('produces an entry from gross salary alone (employer SG, after tax)', () => {
    const grossByMember = new Map([['m1', 80_000_00]])
    const result = netAnnualSuperContributionByMember(
      [],
      grossByMember,
      grossByMember,
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(Math.round(0.12 * 80_000_00 * 0.85))
  })

  it('taxes a contribution with no gross salary, contributing no employer SG', () => {
    const result = netAnnualSuperContributionByMember(
      [contribution()],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(Math.round(13_000_00 * 0.85))
  })
})

describe('netAnnualSuperContributionFromRows', () => {
  it('derives gross from taxable inflows and skips non-taxable ones', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 100_000_00 })
    const nonTaxable = inflow({
      taxable: false,
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 5_000_00,
    })
    const result = netAnnualSuperContributionFromRows([salary, nonTaxable], [])
    expect(result.get('m1')).toBe(
      netAnnualSuperContributionByMember(
        [],
        new Map([['m1', 100_000_00]]),
        new Map([['m1', 100_000_00]]),
        FY2027_CONFIG,
      ).get('m1'),
    )
  })

  it('leaves an allowance that earns no super out of the employer SG base', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 100_000_00 })
    const onCall = inflow({
      attracts_super: false,
      schedule: 'fortnightly',
      interval_count: null,
      amount_cents: 500_00,
    })
    expect(netAnnualSuperContributionFromRows([salary, onCall], []).get('m1')).toBe(
      Math.round(0.12 * 100_000_00 * 0.85),
    )
  })

  it('counts an allowance that earns no super toward the co-contribution income test', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 45_000_00 })
    const onCall = inflow({
      attracts_super: false,
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 12_000_00,
    })
    expect(
      netAnnualSuperContributionFromRows(
        [salary, onCall],
        [
          contribution({
            kind: 'personal_non_concessional',
            frequency: 'annual',
            amount_cents: 1_000_00,
          }),
        ],
      ).get('m1'),
    ).toBe(Math.round(0.12 * 45_000_00 * 0.85) + 1_000_00 + 243_10)
  })
})

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

describe('atPreservationAgeOn', () => {
  it('reads an unknown date of birth as below preservation age — the higher rate', () => {
    expect(atPreservationAgeOn(null, '2026-09-12', FY2027_CONFIG)).toBe(false)
  })

  it('turns over on the birthday the member reaches preservation age', () => {
    expect(atPreservationAgeOn('1966-09-12', '2026-09-11', FY2027_CONFIG)).toBe(false)
    expect(atPreservationAgeOn('1966-09-12', '2026-09-12', FY2027_CONFIG)).toBe(true)
  })
})

/** A taxable one-off severance for `m1`, paid inside FY2027. */
const severance = inflow({
  schedule: null,
  interval_count: null,
  paid_on: '2026-09-12',
  one_off_tax_treatment: 'ordinary',
  amount_cents: 40_000_00,
})

describe('one-off inflows in the tax estimate', () => {
  it('counts a one-off in the annual figures and keeps it out of the fortnightly ones', () => {
    const salary = inflow({ schedule: 'annual', amount_cents: 100_000_00 })
    const withOneOff = estimateHouseholdTaxFromRows([salary, severance], [profile])
    const withoutOneOff = estimateHouseholdTaxFromRows([salary], [profile])
    expect(withOneOff.annualGrossCents).toBe(140_000_00)
    expect(withOneOff.annualOneOffGrossCents).toBe(40_000_00)
    expect(withOneOff.fortnightlyGrossCents).toBe(withoutOneOff.fortnightlyGrossCents)
  })

  it('counts a one-off paid outside the financial year as nothing', () => {
    expect(
      estimateHouseholdTaxFromRows([{ ...severance, paid_on: '2027-09-12' }], [profile])
        .annualOneOffGrossCents,
    ).toBe(0)
  })

  it('reads the member’s age at the payment date from their date of birth', () => {
    const salary = inflow({ schedule: 'annual', amount_cents: 200_000_00 })
    const redundancy = {
      ...severance,
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 0,
      amount_cents: 100_000_00,
    }
    const rows = [salary, redundancy]
    const atAge = estimateHouseholdTaxFromRows(rows, [profile], [], [], [], undefined, undefined, [
      member({ date_of_birth: '1950-01-01' }),
    ])
    const below = estimateHouseholdTaxFromRows(rows, [profile], [], [], [], undefined, undefined, [
      member({ date_of_birth: '1990-01-01' }),
    ])
    expect(atAge.annualOneOffAfterTaxCents).toBeGreaterThan(below.annualOneOffAfterTaxCents)
    expect(estimateHouseholdTaxFromRows(rows, [profile]).annualOneOffAfterTaxCents).toBe(
      below.annualOneOffAfterTaxCents,
    )
  })
})

describe('toIncomeInput', () => {
  it('coerces an unrecognised inflow type to other', () => {
    expect(toIncomeInput(inflow({ type: 'reimbursement' })).type).toBe('other')
  })

  it('maps a member-less inflow to the empty member id', () => {
    expect(toIncomeInput(inflow({ member_id: null })).memberId).toBe('')
  })

  it('carries an hourly wage’s rate and hours through', () => {
    const wage = toIncomeInput(
      inflow({
        type: 'wage',
        schedule: 'fortnightly',
        interval_count: null,
        hourly_rate_cents: 45_00,
        hours_per_period: 38,
      }),
    )
    expect(wage).toMatchObject({ hourlyRateCents: 45_00, hoursPerPeriod: 38 })
  })

  it('carries a one-off’s payment date, its treatment, and the redundancy’s years of service', () => {
    expect(
      toIncomeInput({
        ...severance,
        one_off_tax_treatment: 'genuine_redundancy',
        years_of_service: 8,
      }),
    ).toMatchObject({
      paidOn: '2026-09-12',
      treatment: 'genuineRedundancy',
      yearsOfService: 8,
      atPreservationAge: false,
    })
  })

  it('reads a one-off carrying no treatment as ordinary income', () => {
    expect(
      toIncomeInput({ ...severance, taxable: false, one_off_tax_treatment: null }),
    ).toMatchObject({ treatment: 'ordinary' })
  })

  it('reads a one-off carrying an unrecognised treatment as ordinary income', () => {
    expect(
      toIncomeInput({ ...severance, one_off_tax_treatment: 'not_a_real_treatment' }),
    ).toMatchObject({ treatment: 'ordinary' })
  })
})

describe('ENGINE_ONE_OFF_TREATMENTS', () => {
  it('names each stored treatment as the engine names it', () => {
    expect(ENGINE_ONE_OFF_TREATMENTS).toEqual({
      ordinary: 'ordinary',
      genuine_redundancy: 'genuineRedundancy',
      employment_termination: 'employmentTermination',
      unused_leave: 'unusedLeave',
    })
  })
})

describe('one-off inflows in the super bases', () => {
  it('earns no employer super, so it stays out of the guarantee base', () => {
    const salary = inflow({ schedule: 'annual', amount_cents: 100_000_00 })
    expect(netAnnualSuperContributionFromRows([salary, severance], []).get('m1')).toBe(
      netAnnualSuperContributionFromRows([salary], []).get('m1'),
    )
  })

  it('counts its assessable part in the co-contribution income test, tax-free part aside', () => {
    const redundancy = {
      ...severance,
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 5,
      amount_cents: 70_000_00,
    }
    const nonConcessional = contribution({
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 1_000_00,
    })
    expect(superCapSummaryFromRows([redundancy], [], [nonConcessional]).get('m1')).toMatchObject({
      coContributionCents: 500_00,
    })
    expect(
      superCapSummaryFromRows(
        [{ ...redundancy, one_off_tax_treatment: 'ordinary', years_of_service: null }],
        [],
        [nonConcessional],
      ).get('m1'),
    ).toMatchObject({ coContributionCents: 0 })
    expect(
      superCapSummaryFromRows(
        [{ ...redundancy, one_off_tax_treatment: null, years_of_service: null }],
        [],
        [nonConcessional],
      ).get('m1'),
    ).toMatchObject({ coContributionCents: 0 })
  })
})

describe('splitAcrossMembers', () => {
  it('splits evenly when the amount divides cleanly', () => {
    expect(splitAcrossMembers(100_00, ['m1', 'm2'])).toEqual([50_00, 50_00])
  })

  it('gives the remainder cent to the last member', () => {
    expect(splitAcrossMembers(100_01, ['m1', 'm2'])).toEqual([50_00, 50_01])
    expect(splitAcrossMembers(10, ['m1', 'm2', 'm3'])).toEqual([3, 3, 4])
  })

  it('returns an empty array for no members', () => {
    expect(splitAcrossMembers(100_00, [])).toEqual([])
  })
})

describe('splitByPercent', () => {
  it('splits evenly at 50%', () => {
    expect(splitByPercent(100_00, 50)).toEqual([50_00, 50_00])
  })

  it('splits 70/30 with the named member carrying the rounding', () => {
    expect(splitByPercent(20_000_00, 70)).toEqual([14_000_00, 6_000_00])
  })

  it('assesses nothing to the named member at 0% and everything at 100%', () => {
    expect(splitByPercent(1_234_57, 0)).toEqual([0, 1_234_57])
    expect(splitByPercent(1_234_57, 100)).toEqual([1_234_57, 0])
  })

  it('rounds the named member’s share and lets the other absorb the residual', () => {
    expect(splitByPercent(1_000_01, 33)).toEqual([330_00, 670_01])
    const [a, b] = splitByPercent(999_99, 33)
    expect(a + b).toBe(999_99)
  })
})

describe('inflowIncomeInputs', () => {
  const memberIds = ['m1', 'm2']
  const jointInflow = inflow({
    schedule: 'annual',
    interval_count: null,
    type: 'other',
    member_id: 'm1',
    amount_cents: 20_000_00,
    is_joint: true,
    member_split_percent: 70,
  })

  it('maps a non-joint inflow to a single income input', () => {
    const nonJoint = { ...jointInflow, is_joint: false, member_split_percent: null }
    expect(inflowIncomeInputs(nonJoint, memberIds)).toEqual([toIncomeInput(nonJoint)])
  })

  it('splits a joint inflow between the named member and the other one', () => {
    expect(inflowIncomeInputs(jointInflow, memberIds)).toEqual([
      { memberId: 'm1', type: 'other', schedule: 'annual', amountCents: 14_000_00 },
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 6_000_00 },
    ])
  })

  it('carries the effective window onto both halves', () => {
    const dated = { ...jointInflow, starts_on: '2026-09-15', ends_on: '2027-03-31' }
    expect(inflowIncomeInputs(dated, memberIds)).toEqual([
      {
        memberId: 'm1',
        type: 'other',
        schedule: 'annual',
        amountCents: 14_000_00,
        startsOn: '2026-09-15',
        endsOn: '2027-03-31',
      },
      {
        memberId: 'm2',
        type: 'other',
        schedule: 'annual',
        amountCents: 6_000_00,
        startsOn: '2026-09-15',
        endsOn: '2027-03-31',
      },
    ])
  })

  it('assesses the whole amount to the named member when the household is not exactly two', () => {
    expect(inflowIncomeInputs(jointInflow, ['m1', 'm2', 'm3'])).toEqual([
      toIncomeInput(jointInflow),
    ])
    expect(inflowIncomeInputs(jointInflow, ['m1'])).toEqual([toIncomeInput(jointInflow)])
  })
})

describe('estimateHouseholdTaxFromRows for a joint inflow', () => {
  const members = [member({ id: 'm1' }), member({ id: 'm2' })]
  const profiles: TaxProfileRow[] = [profile, { ...profile, member_id: 'm2' }]
  const salaryFor = (memberId: string) =>
    inflow({
      schedule: 'annual',
      interval_count: null,
      type: 'salary',
      member_id: memberId,
      amount_cents: 90_000_00,
    })
  const jointOther = inflow({
    schedule: 'annual',
    interval_count: null,
    type: 'other',
    member_id: 'm1',
    amount_cents: 20_000_00,
    is_joint: true,
    member_split_percent: 50,
  })
  const rowsWith = (split: number): InflowRow[] => [
    salaryFor('m1'),
    salaryFor('m2'),
    { ...jointOther, member_split_percent: split },
  ]
  const estimateFor = (rows: InflowRow[]) =>
    estimateHouseholdTaxFromRows(rows, profiles, [], [], [], undefined, undefined, members)
  const memberGross = (rows: InflowRow[], memberId: string) =>
    estimateFor(rows).members.find((m) => m.memberId === memberId)!.annualGrossCents

  it('puts half the joint amount on each member at 50/50', () => {
    expect(memberGross(rowsWith(50), 'm1')).toBe(100_000_00)
    expect(memberGross(rowsWith(50), 'm2')).toBe(100_000_00)
  })

  it('splits 70/30 to the member the inflow names', () => {
    expect(memberGross(rowsWith(70), 'm1')).toBe(104_000_00)
    expect(memberGross(rowsWith(70), 'm2')).toBe(96_000_00)
  })

  it('shifts each member’s tax toward their own marginal rate versus assessing it all to one', () => {
    const jointEstimate = estimateFor(rowsWith(50))
    const wholeToM1 = estimateFor([
      salaryFor('m1'),
      salaryFor('m2'),
      { ...jointOther, is_joint: false, member_split_percent: null },
    ])
    const m1 = (e: typeof jointEstimate) => e.members.find((m) => m.memberId === 'm1')!
    const m2 = (e: typeof jointEstimate) => e.members.find((m) => m.memberId === 'm2')!
    expect(m1(jointEstimate).annualTaxCents).toBeLessThan(m1(wholeToM1).annualTaxCents)
    expect(m2(jointEstimate).annualTaxCents).toBeGreaterThan(m2(wholeToM1).annualTaxCents)
  })

  it('leaves a non-joint other inflow assessed wholly to its member', () => {
    const nonJoint = estimateFor([
      salaryFor('m1'),
      salaryFor('m2'),
      { ...jointOther, is_joint: false, member_split_percent: null },
    ])
    expect(nonJoint.members.find((m) => m.memberId === 'm1')!.annualGrossCents).toBe(110_000_00)
    expect(nonJoint.members.find((m) => m.memberId === 'm2')!.annualGrossCents).toBe(90_000_00)
  })

  it('prorates a dated joint inflow by each half’s active share of the year', () => {
    const dated = rowsWith(50).map((row) =>
      row.is_joint ? { ...row, ends_on: '2026-09-14' } : row,
    )
    const share = Math.round((10_000_00 * 76) / 365)
    expect(memberGross(dated, 'm1')).toBe(90_000_00 + share)
    expect(memberGross(dated, 'm2')).toBe(90_000_00 + share)
  })

  it('assesses the whole joint amount to its member in a household that is not exactly two', () => {
    const estimate = estimateHouseholdTaxFromRows(
      rowsWith(50),
      profiles,
      [],
      [],
      [],
      undefined,
      undefined,
      [...members, member({ id: 'm3' })],
    )
    expect(estimate.members.find((m) => m.memberId === 'm1')!.annualGrossCents).toBe(110_000_00)
  })
})

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
