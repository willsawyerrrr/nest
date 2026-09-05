import { afterEach, describe, expect, it, vi } from 'vitest'
import { fortnightlyCents } from '@nest/plan'
import { annualGrossCents, FY2027_CONFIG, type TaxBreakdown } from '@nest/tax'
import type { DeductionRow } from '../hooks/useDeductions'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { Inflow } from '../hooks/useInflows'
import type { SuperContribution } from '../hooks/useSuperContributions'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import { makeGoal, makeMember, makeSaver } from '../test/fixtures'
import {
  activeNowTaxableInflows,
  atPreservationAgeOn,
  concessionalByMember,
  currentTaxConfig,
  deductionsByMember,
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
} from './tax'

const baseInflow: Inflow = {
  id: 'i1',
  household_id: 'h1',
  member_id: 'm1',
  name: 'On-call',
  taxable: true,
  attracts_super: true,
  type: 'salary',
  schedule: 'every_n_weeks',
  interval_count: 4,
  pay_schedule: null,
  pay_interval_count: null,
  arrives_every_pay_period: true,
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
  pay_anchor_date: null,
  created_at: '',
  updated_at: '',
}

const profile: TaxProfile = {
  id: 'p1',
  household_id: 'h1',
  member_id: 'm1',
  financial_year: 2027,
  residency: 'resident',
  has_private_hospital_cover: false,
  created_at: '',
  updated_at: '',
}

const baseProfile: SuperProfile = {
  id: 'sp1',
  household_id: 'h1',
  member_id: 'm1',
  financial_year: 2027,
  fund_name: null,
  sg_rate_override: null,
  linked_account_id: null,
  carry_forward_cap_cents: 0,
  balance_as_of: null,
  created_at: '',
  updated_at: '',
}

const baseContribution: SuperContribution = {
  id: 'c1',
  household_id: 'h1',
  member_id: 'm1',
  financial_year: 2027,
  kind: 'salary_sacrifice',
  mode: 'amount',
  amount_cents: 500_00,
  percent_bp: null,
  frequency: 'fortnightly',
  interval_count: null,
  fhss_eligible: false,
  contributor_member_id: null,
  created_at: '',
  updated_at: '',
}

describe('currentTaxConfig', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('selects the versioned config for a date inside its financial year', () => {
    // 15 Sep 2026 falls in FY2027 (1 Jul 2026 – 30 Jun 2027), which has a config.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T00:00:00Z'))
    const config = currentTaxConfig()
    expect(config.financialYear).toBe(2027)
    expect(config).toBe(FY2027_CONFIG)
  })

  it('falls back to FY2027 for a date whose financial year has no config', () => {
    // 1 Jan 2050 falls in FY2050, which has no versioned config, so resolution
    // falls back to FY2027 rather than the date's own financial year.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2050-01-01T00:00:00Z'))
    const config = currentTaxConfig()
    expect(config.financialYear).toBe(2027)
    expect(config).toBe(FY2027_CONFIG)
  })
})

describe('concessionalByMember', () => {
  it('annualises an amount-mode concessional contribution by frequency', () => {
    // $500/fortnight salary sacrifice → 500_00 × 26 = 13_000_00/yr.
    const result = concessionalByMember([baseContribution], new Map())
    expect(result.get('m1')).toBe(13_000_00)
  })

  it('resolves a percent-mode contribution against the member gross salary', () => {
    // 10% of $100,000 → 10_000_00/yr.
    const percentRow: SuperContribution = {
      ...baseContribution,
      kind: 'personal_deductible',
      mode: 'percent',
      amount_cents: null,
      percent_bp: 1000,
      frequency: 'annual',
    }
    const result = concessionalByMember([percentRow], new Map([['m1', 100_000_00]]))
    expect(result.get('m1')).toBe(10_000_00)
  })

  it('sums concessional kinds and excludes non-concessional and spouse contributions', () => {
    const rows: SuperContribution[] = [
      baseContribution,
      { ...baseContribution, id: 'c2', kind: 'personal_deductible', frequency: 'annual' },
      { ...baseContribution, id: 'c3', kind: 'personal_non_concessional', frequency: 'annual' },
      { ...baseContribution, id: 'c4', kind: 'spouse', contributor_member_id: 'm2' },
    ]
    const result = concessionalByMember(rows, new Map())
    // Only salary sacrifice (13_000_00) + personal deductible annual (500_00) count.
    expect(result.get('m1')).toBe(13_000_00 + 500_00)
  })

  it('yields zero for a percent-mode contribution with no rate against an unknown member gross', () => {
    const percentRow: SuperContribution = {
      ...baseContribution,
      mode: 'percent',
      amount_cents: null,
      percent_bp: null,
      frequency: 'annual',
    }
    // No rate and no gross salary for the member: 0% of $0 is nothing.
    const result = concessionalByMember([percentRow], new Map())
    expect(result.get('m1')).toBe(0)
  })

  it('yields zero for an amount-mode contribution with no amount', () => {
    const amountRow: SuperContribution = {
      ...baseContribution,
      mode: 'amount',
      amount_cents: null,
      frequency: 'annual',
    }
    const result = concessionalByMember([amountRow], new Map())
    expect(result.get('m1')).toBe(0)
  })
})

describe('estimateHouseholdTaxFromRows', () => {
  it('reduces taxable income by concessional contributions', () => {
    const salary: Inflow = {
      ...baseInflow,
      schedule: 'annual',
      interval_count: null,
      amount_cents: 100_000_00,
    }
    const contribution: SuperContribution = {
      ...baseContribution,
      frequency: 'annual',
      amount_cents: 15_000_00,
    }
    const withSuper = estimateHouseholdTaxFromRows([salary], [profile], [contribution])
    const withoutSuper = estimateHouseholdTaxFromRows([salary], [profile], [])
    const member = withSuper.members[0]!
    expect(member.annualConcessionalContributionsCents).toBe(15_000_00)
    expect(member.annualTaxCents).toBeLessThan(withoutSuper.members[0]!.annualTaxCents)
  })

  it('maps a foreign-resident profile through the estimate', () => {
    const salary: Inflow = {
      ...baseInflow,
      schedule: 'annual',
      interval_count: null,
      amount_cents: 100_000_00,
    }
    const estimate = estimateHouseholdTaxFromRows(
      [salary],
      [{ ...profile, residency: 'foreign_resident' }],
    )
    expect(estimate.members).toHaveLength(1)
    expect(estimate.annualGrossCents).toBe(100_000_00)
  })

  const highSalary: Inflow = {
    ...baseInflow,
    schedule: 'annual',
    interval_count: null,
    amount_cents: 100_000_00,
  }

  it('threads a member HELP balance from the help-debt rows into the estimate', () => {
    const helpDebt: HelpDebt = {
      id: 'hd1',
      household_id: 'h1',
      member_id: 'm1',
      balance_cents: 30_000_00,
      created_at: '',
      updated_at: '',
    }
    const withHelp = estimateHouseholdTaxFromRows([highSalary], [profile], [], [helpDebt])
    const withoutHelp = estimateHouseholdTaxFromRows([highSalary], [profile], [], [])
    expect(withHelp.members[0]!.breakdown.helpRepaymentCents).toBeGreaterThan(0)
    expect(withoutHelp.members[0]!.breakdown.helpRepaymentCents).toBe(0)
  })

  it('assesses a HELP balance for a member with no tax profile', () => {
    const helpDebt: HelpDebt = {
      id: 'hd1',
      household_id: 'h1',
      member_id: 'm1',
      balance_cents: 30_000_00,
      created_at: '',
      updated_at: '',
    }
    const estimate = estimateHouseholdTaxFromRows([highSalary], [], [], [helpDebt])
    expect(estimate.members[0]!.breakdown.helpRepaymentCents).toBeGreaterThan(0)
  })

  it('ignores a zero HELP balance for a member with no tax profile', () => {
    const zeroDebt: HelpDebt = {
      id: 'hd2',
      household_id: 'h1',
      member_id: 'm1',
      balance_cents: 0,
      created_at: '',
      updated_at: '',
    }
    const estimate = estimateHouseholdTaxFromRows([highSalary], [], [], [zeroDebt])
    expect(estimate.members[0]!.breakdown.helpRepaymentCents).toBe(0)
  })

  it('annualises an every-N-weeks taxable inflow via the shared normalization', () => {
    // $300 every 4 weeks → round(300_00 × 52 / 4) = 3_900_00/yr.
    const estimate = estimateHouseholdTaxFromRows([baseInflow], [profile])
    expect(estimate.annualGrossCents).toBe(3_900_00)
  })

  it('matches the fortnightly case when the interval is 2 weeks', () => {
    const everyTwoWeeks = estimateHouseholdTaxFromRows(
      [{ ...baseInflow, schedule: 'every_n_weeks', interval_count: 2 }],
      [profile],
    )
    const fortnightly = estimateHouseholdTaxFromRows(
      [{ ...baseInflow, schedule: 'fortnightly', interval_count: null }],
      [profile],
    )
    expect(everyTwoWeeks.annualGrossCents).toBe(fortnightly.annualGrossCents)
    expect(everyTwoWeeks.annualTaxCents).toBe(fortnightly.annualTaxCents)
  })
})

describe('estimateHouseholdTaxFromRows for pay arriving in only some periods', () => {
  /** The household's on-call tier: $6,600 a year, landing in only some fortnights. */
  const onCall: Inflow = {
    ...baseInflow,
    id: 'i2',
    name: 'On-call (T1)',
    type: 'other',
    schedule: 'annual',
    interval_count: null,
    amount_cents: 6_600_00,
    pay_schedule: 'fortnightly',
    arrives_every_pay_period: false,
    attracts_super: false,
  }

  it('counts the whole year’s projection whether or not it lands every period', () => {
    // The flag is about WHEN the money lands, never whether it is expected: an
    // allowance worth $6,600 a year is assessable income of $6,600 either way.
    const occasional = estimateHouseholdTaxFromRows([onCall], [profile])
    const everyPeriod = estimateHouseholdTaxFromRows(
      [{ ...onCall, arrives_every_pay_period: true }],
      [profile],
    )
    expect(occasional.annualGrossCents).toBe(6_600_00)
    expect(occasional.annualGrossCents).toBe(everyPeriod.annualGrossCents)
    expect(occasional.annualTaxCents).toBe(everyPeriod.annualTaxCents)
    expect(occasional.members[0]!.breakdown).toEqual(everyPeriod.members[0]!.breakdown)
  })

  it('keeps the super bases and the co-contribution income test unchanged', () => {
    // The allowance earns no super either way, and is assessable in full either way,
    // so the two bases the flag could have moved are identical.
    const rows: [Inflow[], Inflow[]] = [
      [
        { ...baseInflow, schedule: 'annual', interval_count: null, amount_cents: 90_000_00 },
        onCall,
      ],
      [
        { ...baseInflow, schedule: 'annual', interval_count: null, amount_cents: 90_000_00 },
        { ...onCall, arrives_every_pay_period: true },
      ],
    ]
    const [occasional, everyPeriod] = rows.map((inflows) =>
      superCapSummaryFromRows(inflows, [baseProfile], []).get('m1')!,
    )
    expect(occasional).toEqual(everyPeriod)
  })

  it('normalises to the same fortnightly and annual figures the plan reads', () => {
    // The figure the inflow list and the budget's normalisation show: $6,600 a year
    // spread over the year, which is what the plan projects.
    const annual = annualGrossCents(toIncomeInput(onCall))
    expect(annual).toBe(6_600_00)
    expect(annual).toBe(
      annualGrossCents(toIncomeInput({ ...onCall, arrives_every_pay_period: true })),
    )
    expect(fortnightlyCents(annual, 'annual')).toBe(253_85)
  })
})

describe('estimateHouseholdTaxFromRows effective dates', () => {
  const oldRate: Inflow = {
    ...baseInflow,
    schedule: 'annual',
    interval_count: null,
    amount_cents: 90_000_00,
    ends_on: '2026-09-14',
  }
  const newRate: Inflow = {
    ...baseInflow,
    id: 'i2',
    schedule: 'annual',
    interval_count: null,
    amount_cents: 100_000_00,
    starts_on: '2026-09-15',
  }

  it('prorates a mid-year pay rise across the two dated rates by calendar days', () => {
    // FY2027 is 365 days: the old rate is active 1 Jul–14 Sep (76 days) and the
    // new rate 15 Sep–30 Jun (289 days), adjacent windows covering the whole year.
    const expected = Math.round((90_000_00 * 76) / 365) + Math.round((100_000_00 * 289) / 365)
    const estimate = estimateHouseholdTaxFromRows([oldRate, newRate], [profile])
    expect(estimate.annualGrossCents).toBe(expected)
    // The prorated gross sits strictly between the two flat-rate annual figures.
    expect(estimate.annualGrossCents).toBeGreaterThan(90_000_00)
    expect(estimate.annualGrossCents).toBeLessThan(100_000_00)
  })

  it('leaves undated income at its full steady-rate gross', () => {
    const undated: Inflow = {
      ...baseInflow,
      schedule: 'annual',
      interval_count: null,
      amount_cents: 90_000_00,
    }
    expect(estimateHouseholdTaxFromRows([undated], [profile]).annualGrossCents).toBe(90_000_00)
  })
})

describe('activeNowTaxableInflows', () => {
  const now = new Date('2026-12-01T00:00:00Z')
  const recurring: Inflow = { ...baseInflow, schedule: 'annual', interval_count: null }

  it('keeps an active recurring inflow with its effective dates cleared', () => {
    const dated: Inflow = { ...recurring, starts_on: '2026-07-01', ends_on: '2027-06-30' }
    expect(activeNowTaxableInflows([dated], now)).toEqual([
      { ...dated, starts_on: null, ends_on: null },
    ])
  })

  it('keeps an open-ended recurring inflow untouched aside from the (already null) dates', () => {
    expect(activeNowTaxableInflows([recurring], now)).toEqual([recurring])
  })

  it('drops a recurring inflow that ended before now', () => {
    const ended: Inflow = { ...recurring, ends_on: '2026-09-30' }
    expect(activeNowTaxableInflows([ended], now)).toEqual([])
  })

  it('drops a recurring inflow that starts after now', () => {
    const future: Inflow = { ...recurring, starts_on: '2027-03-01' }
    expect(activeNowTaxableInflows([future], now)).toEqual([])
  })

  it('passes a one-off through unchanged, dates and all', () => {
    const oneOff: Inflow = {
      ...baseInflow,
      schedule: null,
      interval_count: null,
      paid_on: '2026-08-15',
    }
    expect(activeNowTaxableInflows([oneOff], now)).toEqual([oneOff])
  })

  it('drops a non-taxable inflow', () => {
    expect(activeNowTaxableInflows([{ ...recurring, taxable: false }], now)).toEqual([])
  })
})

describe('deductionsByMember', () => {
  const baseDeduction: DeductionRow = {
    id: 'd1',
    household_id: 'h1',
    member_id: 'm1',
    description: 'Home office',
    amount_cents: 1_200_00,
    deduction_date: '2026-08-01',
    financial_year: 2027,
    basis: 'amount',
    distance_km: null,
    group_id: null,
    full_amount_cents: 1_200_00,
    work_use_percent: 100,
    category: 'work_expense',
    created_at: '',
    updated_at: '',
  }

  it('sums each member deduction amount by member id', () => {
    const result = deductionsByMember([
      baseDeduction,
      { ...baseDeduction, id: 'd2', amount_cents: 300_00 },
      { ...baseDeduction, id: 'd3', member_id: 'm2', amount_cents: 500_00 },
    ])
    expect(result.get('m1')).toBe(1_500_00)
    expect(result.get('m2')).toBe(500_00)
  })
})

describe('estimateHouseholdTaxFromRows deductions', () => {
  const salary: Inflow = {
    ...baseInflow,
    schedule: 'annual',
    interval_count: null,
    amount_cents: 100_000_00,
  }
  const deduction: DeductionRow = {
    id: 'd1',
    household_id: 'h1',
    member_id: 'm1',
    description: 'Tools',
    amount_cents: 10_000_00,
    deduction_date: '2026-08-01',
    financial_year: 2027,
    basis: 'amount',
    distance_km: null,
    group_id: null,
    full_amount_cents: 10_000_00,
    work_use_percent: 100,
    category: 'work_expense',
    created_at: '',
    updated_at: '',
  }

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
    const debts: HelpDebt[] = [
      {
        id: 'hd1',
        household_id: 'h1',
        member_id: 'm1',
        balance_cents: 30_000_00,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'hd2',
        household_id: 'h1',
        member_id: 'm2',
        balance_cents: 5_000_00,
        created_at: '',
        updated_at: '',
      },
    ]
    const result = helpDebtCentsByMember(debts)
    expect(result.get('m1')).toBe(30_000_00)
    expect(result.get('m2')).toBe(5_000_00)
  })
})

describe('nonConcessionalByMember', () => {
  const nonConcessional: SuperContribution = {
    ...baseContribution,
    kind: 'personal_non_concessional',
  }

  it('annualises an amount-mode non-concessional contribution by frequency', () => {
    // $500/fortnight after-tax → 500_00 × 26 = 13_000_00/yr.
    const result = nonConcessionalByMember([nonConcessional], new Map())
    expect(result.get('m1')).toBe(13_000_00)
  })

  it('resolves a percent-mode contribution against the member gross salary', () => {
    const percentRow: SuperContribution = {
      ...nonConcessional,
      mode: 'percent',
      amount_cents: null,
      percent_bp: 500,
      frequency: 'annual',
    }
    // 5% of $100,000 → 5_000_00/yr.
    const result = nonConcessionalByMember([percentRow], new Map([['m1', 100_000_00]]))
    expect(result.get('m1')).toBe(5_000_00)
  })

  it('excludes concessional and spouse contributions', () => {
    const rows: SuperContribution[] = [
      nonConcessional,
      { ...baseContribution, id: 'c2', kind: 'salary_sacrifice' },
      { ...baseContribution, id: 'c3', kind: 'spouse', contributor_member_id: 'm2' },
    ]
    const result = nonConcessionalByMember(rows, new Map())
    expect(result.get('m1')).toBe(13_000_00)
  })
})

describe('superCapSummaryByMember', () => {
  it('flags concessional over the effective cap, including carry-forward', () => {
    const concessional: SuperContribution = {
      ...baseContribution,
      kind: 'salary_sacrifice',
      frequency: 'annual',
      amount_cents: 40_000_00,
    }
    const withCarry = superCapSummaryByMember(
      [concessional],
      [{ ...baseProfile, carry_forward_cap_cents: 10_000_00 }],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    ).get('m1')!
    // Config cap $32,500 + $10,000 carry-forward = $42,500; $40,000 is under it.
    expect(withCarry.concessionalCapCents).toBe(42_500_00)
    expect(withCarry.concessionalOverCap).toBe(false)

    const noCarry = superCapSummaryByMember(
      [concessional],
      [baseProfile],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    ).get('m1')!
    // Without carry-forward the $32,500 cap is exceeded.
    expect(noCarry.concessionalCapCents).toBe(32_500_00)
    expect(noCarry.concessionalOverCap).toBe(true)
  })

  it('flags non-concessional over the cap and reports the co-contribution', () => {
    const over: SuperContribution = {
      ...baseContribution,
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 140_000_00,
    }
    const summary = superCapSummaryByMember(
      [over],
      [baseProfile],
      new Map([['m1', 40_000_00]]),
      new Map([['m1', 40_000_00]]),
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.nonConcessionalCapCents).toBe(130_000_00)
    expect(summary.nonConcessionalOverCap).toBe(true)
    // Income below the $49,293 lower threshold: full $500 co-contribution.
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
    const contribution: SuperContribution = {
      ...baseContribution,
      member_id: 'm2',
      kind: 'salary_sacrifice',
      frequency: 'annual',
      amount_cents: 5_000_00,
    }
    // m1 has a profile; m2 contributes but has no profile, so no carry-forward
    // entry: their cap falls back to the bare config cap.
    const summaries = superCapSummaryByMember(
      [contribution],
      [{ ...baseProfile, member_id: 'm1' }],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    )
    expect(summaries.get('m2')!.concessionalCapCents).toBe(32_500_00)
    expect(summaries.get('m2')!.concessionalCents).toBe(5_000_00)
  })

  it('tests the co-contribution against assessable income, not ordinary time earnings', () => {
    const contribution: SuperContribution = {
      ...baseContribution,
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 1_000_00,
    }
    const summary = superCapSummaryByMember(
      [contribution],
      [baseProfile],
      new Map([['m1', 45_000_00]]),
      new Map([['m1', 57_000_00]]),
      FY2027_CONFIG,
    ).get('m1')!
    // The taper on $57,000 of assessable income. The $45,000 ordinary-time base
    // alone sits under the lower threshold and would award the whole $500.
    expect(summary.coContributionCents).toBe(243_10)
  })
})

describe('superCapSummaryFromRows', () => {
  it('derives the co-contribution income test from taxable inflows', () => {
    const salary: Inflow = {
      ...baseInflow,
      schedule: 'annual',
      interval_count: null,
      amount_cents: 49_293_00,
    }
    const contribution: SuperContribution = {
      ...baseContribution,
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 1_000_00,
    }
    const summary = superCapSummaryFromRows([salary], [baseProfile], [contribution]).get('m1')!
    expect(summary.nonConcessionalCents).toBe(1_000_00)
    // At the lower threshold the max still applies; 50% × $1,000 = $500 is not the binder.
    expect(summary.coContributionCents).toBe(500_00)
  })

  it('counts an allowance that earns no super toward the co-contribution income test', () => {
    const salary: Inflow = {
      ...baseInflow,
      schedule: 'annual',
      interval_count: null,
      amount_cents: 45_000_00,
    }
    // An allowance is assessable in full, so the income test is on $57,000, not
    // on the $45,000 the super guarantee is charged on.
    const onCall: Inflow = {
      ...baseInflow,
      id: 'i2',
      name: 'On-call (T1)',
      attracts_super: false,
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 12_000_00,
    }
    const contribution: SuperContribution = {
      ...baseContribution,
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 1_000_00,
    }
    const summary = superCapSummaryFromRows(
      [salary, onCall],
      [baseProfile],
      [contribution],
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.coContributionCents).toBe(243_10)
  })
})

describe('netAnnualSuperContributionByMember', () => {
  it('taxes concessional and employer SG at 15% and adds after-tax amounts untaxed', () => {
    // Gross $100k → employer SG 12% = $12,000; salary sacrifice $500/fn = $13,000.
    // After-tax concessional = ($12,000 + $13,000) × 0.85 = $21,250. No non-conc.
    const grossByMember = new Map([['m1', 100_000_00]])
    const result = netAnnualSuperContributionByMember(
      [baseContribution],
      grossByMember,
      grossByMember,
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(21_250_00)
  })

  it('adds non-concessional contributions and the co-contribution without taxing them', () => {
    // At the lower income threshold: employer SG only, plus $1,000 non-concessional
    // and its $500 co-contribution, neither taxed in the fund.
    const grossByMember = new Map([['m1', 49_293_00]])
    const contribution: SuperContribution = {
      ...baseContribution,
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 1_000_00,
    }
    const sgAfterTax = Math.round(0.12 * 49_293_00 * 0.85)
    const result = netAnnualSuperContributionByMember(
      [contribution],
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
    // The member contributes but has no gross salary on record, so there is no
    // employer SG; only the salary sacrifice is taxed at 15% in the fund.
    const result = netAnnualSuperContributionByMember(
      [baseContribution],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(Math.round(13_000_00 * 0.85))
  })
})

describe('netAnnualSuperContributionFromRows', () => {
  it('derives gross from taxable inflows and skips non-taxable ones', () => {
    const salary: Inflow = {
      ...baseInflow,
      schedule: 'annual',
      interval_count: null,
      amount_cents: 100_000_00,
    }
    const nonTaxable: Inflow = {
      ...baseInflow,
      id: 'i2',
      taxable: false,
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 5_000_00,
    }
    // The non-taxable inflow is ignored, so the result matches gross-only super
    // on the $100k salary using the current financial year's config (FY2027).
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
    const salary: Inflow = {
      ...baseInflow,
      schedule: 'annual',
      interval_count: null,
      amount_cents: 100_000_00,
    }
    // Taxed in full, but no super guarantee accrues on it, so the SG base stays
    // the $100k salary rather than rising to $113,000.
    const onCall: Inflow = {
      ...baseInflow,
      id: 'i2',
      name: 'On-call (T1)',
      attracts_super: false,
      schedule: 'fortnightly',
      interval_count: null,
      amount_cents: 500_00,
    }
    expect(netAnnualSuperContributionFromRows([salary, onCall], []).get('m1')).toBe(
      Math.round(0.12 * 100_000_00 * 0.85),
    )
  })

  it('counts an allowance that earns no super toward the co-contribution income test', () => {
    const salary: Inflow = {
      ...baseInflow,
      schedule: 'annual',
      interval_count: null,
      amount_cents: 45_000_00,
    }
    const onCall: Inflow = {
      ...baseInflow,
      id: 'i2',
      name: 'On-call (T1)',
      attracts_super: false,
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 12_000_00,
    }
    const contribution: SuperContribution = {
      ...baseContribution,
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 1_000_00,
    }
    // SG on the $45,000 salary alone, plus the after-tax contribution and the
    // co-contribution the $57,000 income test tapers to $243.10.
    expect(netAnnualSuperContributionFromRows([salary, onCall], [contribution]).get('m1')).toBe(
      Math.round(0.12 * 45_000_00 * 0.85) + 1_000_00 + 243_10,
    )
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
    // FY2027: index $2,000 by 3.5% to $2,070, then a $3,070.80 repayment clears it.
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
    const highSalary: Inflow = {
      ...baseInflow,
      schedule: 'annual',
      interval_count: null,
      amount_cents: 100_000_00,
    }
    const helpDebt: HelpDebt = {
      id: 'hd1',
      household_id: 'h1',
      member_id: 'm1',
      balance_cents: 30_000_00,
      created_at: '',
      updated_at: '',
    }
    const estimate = estimateHouseholdTaxFromRows([highSalary], [profile], [], [helpDebt])
    const byMember = helpPayoffByMember(estimate, [helpDebt], FY2027_CONFIG)
    expect(byMember.has('m1')).toBe(true)
    expect(byMember.get('m1')?.schedule.length).toBeGreaterThan(0)

    const noDebt = helpPayoffByMember(estimate, [], FY2027_CONFIG)
    expect(noDebt.size).toBe(0)
  })
})

describe('atPreservationAgeOn', () => {
  it('reads an unknown date of birth as below preservation age — the higher rate', () => {
    expect(atPreservationAgeOn(null, '2026-09-12', FY2027_CONFIG)).toBe(false)
  })

  it('turns over on the birthday the member reaches preservation age', () => {
    // FY2027 preservation age is 60, so a 1966-09-12 birth reaches it on 2026-09-12.
    expect(atPreservationAgeOn('1966-09-12', '2026-09-11', FY2027_CONFIG)).toBe(false)
    expect(atPreservationAgeOn('1966-09-12', '2026-09-12', FY2027_CONFIG)).toBe(true)
  })
})

/** A taxable one-off severance for `m1`, paid inside FY2027. */
const severance: Inflow = {
  ...baseInflow,
  id: 'i-oneoff',
  name: 'Severance',
  schedule: null,
  interval_count: null,
  paid_on: '2026-09-12',
  one_off_tax_treatment: 'ordinary',
  amount_cents: 40_000_00,
}

describe('one-off inflows in the tax estimate', () => {
  it('counts a one-off in the annual figures and keeps it out of the fortnightly ones', () => {
    const salary: Inflow = { ...baseInflow, schedule: 'annual', amount_cents: 100_000_00 }
    const withOneOff = estimateHouseholdTaxFromRows([salary, severance], [profile])
    const withoutOneOff = estimateHouseholdTaxFromRows([salary], [profile])

    expect(withOneOff.annualGrossCents).toBe(140_000_00)
    expect(withOneOff.annualOneOffGrossCents).toBe(40_000_00)
    expect(withOneOff.fortnightlyGrossCents).toBe(withoutOneOff.fortnightlyGrossCents)
  })

  it('counts a one-off paid outside the financial year as nothing', () => {
    const nextYear: Inflow = { ...severance, paid_on: '2027-09-12' }
    expect(estimateHouseholdTaxFromRows([nextYear], [profile]).annualOneOffGrossCents).toBe(0)
  })

  it('reads the member’s age at the payment date from their date of birth', () => {
    // A redundancy above a top-bracket salary, so the capped rate really does bite:
    // it is an excluded payment, bounded by the ETP cap rather than by the salary.
    const salary: Inflow = { ...baseInflow, schedule: 'annual', amount_cents: 200_000_00 }
    const redundancy: Inflow = {
      ...severance,
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 0,
      amount_cents: 100_000_00,
    }
    const rows = [salary, redundancy]
    const atAge = estimateHouseholdTaxFromRows(rows, [profile], [], [], [], undefined, undefined, [
      makeMember({ id: 'm1', date_of_birth: '1950-01-01' }),
    ])
    const below = estimateHouseholdTaxFromRows(rows, [profile], [], [], [], undefined, undefined, [
      makeMember({ id: 'm1', date_of_birth: '1990-01-01' }),
    ])
    // The lower capped rate leaves a bigger offset, so less tax and more kept.
    expect(atAge.annualOneOffAfterTaxCents).toBeGreaterThan(below.annualOneOffAfterTaxCents)
    // With no member supplied at all, the higher rate stands.
    expect(estimateHouseholdTaxFromRows(rows, [profile]).annualOneOffAfterTaxCents).toBe(
      below.annualOneOffAfterTaxCents,
    )
  })
})

describe('toIncomeInput for a one-off', () => {
  it('carries the payment date, its treatment, and the redundancy’s years of service', () => {
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
    // A non-taxable one-off — a gift — stores none, being taxed under nothing.
    expect(
      toIncomeInput({ ...severance, taxable: false, one_off_tax_treatment: null }),
    ).toMatchObject({ treatment: 'ordinary' })
  })
})

describe('one-off inflows in the super bases', () => {
  it('earns no employer super, so it stays out of the guarantee base', () => {
    const salary: Inflow = { ...baseInflow, schedule: 'annual', amount_cents: 100_000_00 }
    const withOneOff = netAnnualSuperContributionFromRows([salary, severance], [])
    const withoutOneOff = netAnnualSuperContributionFromRows([salary], [])
    expect(withOneOff.get('m1')).toBe(withoutOneOff.get('m1'))
  })

  it('counts its assessable part in the co-contribution income test, tax-free part aside', () => {
    const redundancy: Inflow = {
      ...severance,
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 5,
      amount_cents: 70_000_00,
    }
    const contribution: SuperContribution = {
      id: 's1',
      household_id: 'h1',
      member_id: 'm1',
      financial_year: 2027,
      kind: 'personal_non_concessional',
      mode: 'amount',
      amount_cents: 1_000_00,
      percent_bp: null,
      frequency: 'annual',
      interval_count: null,
      contributor_member_id: null,
      fhss_eligible: false,
      created_at: '',
      updated_at: '',
    }
    // $13,598 + 5 × $6,801 of the $70,000 is tax free, leaving $22,397 assessable —
    // under the taper's lower threshold, so the whole entitlement stands. The same
    // amount as ordinary income is $70,000 assessable, above the taper entirely.
    expect(superCapSummaryFromRows([redundancy], [], [contribution]).get('m1')).toMatchObject({
      coContributionCents: 500_00,
    })
    expect(
      superCapSummaryFromRows(
        [{ ...redundancy, one_off_tax_treatment: 'ordinary', years_of_service: null }],
        [],
        [contribution],
      ).get('m1'),
    ).toMatchObject({ coContributionCents: 0 })
    // A one-off carrying no treatment at all is assessable in full, as ordinary is.
    expect(
      superCapSummaryFromRows(
        [{ ...redundancy, one_off_tax_treatment: null, years_of_service: null }],
        [],
        [contribution],
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
    // 33% of $1,000.01 = $330.0033 → $330.00, remainder $670.01.
    expect(splitByPercent(1_000_01, 33)).toEqual([330_00, 670_01])
    const [a, b] = splitByPercent(999_99, 33)
    expect(a + b).toBe(999_99)
  })
})

describe('inflowIncomeInputs', () => {
  const memberIds = ['m1', 'm2']
  const jointInflow: Inflow = {
    ...baseInflow,
    schedule: 'annual',
    interval_count: null,
    type: 'other',
    member_id: 'm1',
    amount_cents: 20_000_00,
    is_joint: true,
    member_split_percent: 70,
  }

  it('maps a non-joint inflow to a single income input', () => {
    expect(
      inflowIncomeInputs(
        { ...jointInflow, is_joint: false, member_split_percent: null },
        memberIds,
      ),
    ).toEqual([toIncomeInput({ ...jointInflow, is_joint: false, member_split_percent: null })])
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
  const members = [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })]
  const profiles: TaxProfile[] = [profile, { ...profile, id: 'p2', member_id: 'm2' }]
  const salaryFor = (memberId: string): Inflow => ({
    ...baseInflow,
    id: `salary-${memberId}`,
    schedule: 'annual',
    interval_count: null,
    type: 'salary',
    member_id: memberId,
    amount_cents: 90_000_00,
  })
  const jointOther: Inflow = {
    ...baseInflow,
    id: 'joint',
    schedule: 'annual',
    interval_count: null,
    type: 'other',
    member_id: 'm1',
    amount_cents: 20_000_00,
    is_joint: true,
    member_split_percent: 50,
  }
  const rowsWith = (split: number): Inflow[] => [
    salaryFor('m1'),
    salaryFor('m2'),
    { ...jointOther, member_split_percent: split },
  ]
  const estimateFor = (rows: Inflow[]) =>
    estimateHouseholdTaxFromRows(rows, profiles, [], [], [], undefined, undefined, members)

  const memberGross = (rows: Inflow[], memberId: string) =>
    estimateFor(rows).members.find((member) => member.memberId === memberId)!.annualGrossCents

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
    const m1 = (e: typeof jointEstimate) => e.members.find((member) => member.memberId === 'm1')!
    const m2 = (e: typeof jointEstimate) => e.members.find((member) => member.memberId === 'm2')!
    expect(m1(jointEstimate).annualTaxCents).toBeLessThan(m1(wholeToM1).annualTaxCents)
    expect(m2(jointEstimate).annualTaxCents).toBeGreaterThan(m2(wholeToM1).annualTaxCents)
  })

  it('leaves a non-joint other inflow assessed wholly to its member', () => {
    const nonJoint = estimateFor([
      salaryFor('m1'),
      salaryFor('m2'),
      { ...jointOther, is_joint: false, member_split_percent: null },
    ])
    expect(nonJoint.members.find((member) => member.memberId === 'm1')!.annualGrossCents).toBe(
      110_000_00,
    )
    expect(nonJoint.members.find((member) => member.memberId === 'm2')!.annualGrossCents).toBe(
      90_000_00,
    )
  })

  it('prorates a dated joint inflow by each half’s active share of the year', () => {
    const dated = rowsWith(50).map((row) =>
      row.id === 'joint' ? { ...row, ends_on: '2026-09-14' } : row,
    )
    // The joint halves are active 1 Jul–14 Sep (76 of 365 days).
    const share = Math.round((10_000_00 * 76) / 365)
    expect(memberGross(dated, 'm1')).toBe(90_000_00 + share)
    expect(memberGross(dated, 'm2')).toBe(90_000_00 + share)
  })

  it('assesses the whole joint amount to its member in a household that is not exactly two', () => {
    const threeMembers = [...members, makeMember({ id: 'm3' })]
    const estimate = estimateHouseholdTaxFromRows(
      rowsWith(50),
      profiles,
      [],
      [],
      [],
      undefined,
      undefined,
      threeMembers,
    )
    expect(estimate.members.find((member) => member.memberId === 'm1')!.annualGrossCents).toBe(
      110_000_00,
    )
  })
})

describe('projectedInterestIncomeInputs', () => {
  const members = [makeMember({ id: 'm1' }), makeMember({ id: 'm2' })]

  it('attributes a goal linked to an individually-owned saver wholly to its owner', () => {
    const saver = makeSaver({ id: 'a1', owner_member_id: 'm2', balance_cents: 20_000_00 })
    const goal = makeGoal({ linked_account_id: 'a1', annual_interest_bps: 500 })
    expect(projectedInterestIncomeInputs([goal], [saver], members)).toEqual([
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 1_000_00 },
    ])
  })

  it('splits a joint saver’s interest 50/50, the remainder cent to the last member', () => {
    const saver = makeSaver({ id: 'a1', owner_member_id: null, balance_cents: 10_000_01 })
    const goal = makeGoal({ linked_account_id: 'a1', annual_interest_bps: 100 })
    // 1% of $10,000.01 = $100.0001 → rounds to $100.00, split 50/50.
    expect(projectedInterestIncomeInputs([goal], [saver], members)).toEqual([
      { memberId: 'm1', type: 'other', schedule: 'annual', amountCents: 50_00 },
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 50_00 },
    ])
    const bigger = makeSaver({ id: 'a1', owner_member_id: null, balance_cents: 33_333_00 })
    // 3% of $33,333 = $999.99 → 49_999 / 50_000 split.
    expect(
      projectedInterestIncomeInputs(
        [makeGoal({ linked_account_id: 'a1', annual_interest_bps: 300 })],
        [bigger],
        members,
      ),
    ).toEqual([
      { memberId: 'm1', type: 'other', schedule: 'annual', amountCents: 49_999 },
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 50_000 },
    ])
  })

  it('splits 50/50 off current_balance_cents when the goal has no linked account', () => {
    const goal = makeGoal({
      linked_account_id: null,
      current_balance_cents: 40_000_00,
      annual_interest_bps: 500,
    })
    expect(projectedInterestIncomeInputs([goal], [], members)).toEqual([
      { memberId: 'm1', type: 'other', schedule: 'annual', amountCents: 1_000_00 },
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 1_000_00 },
    ])
  })

  it('splits 50/50 off current_balance_cents when the linked account is unknown', () => {
    const goal = makeGoal({
      linked_account_id: 'missing',
      current_balance_cents: 40_000_00,
      annual_interest_bps: 500,
    })
    expect(projectedInterestIncomeInputs([goal], [], members).map((i) => i.amountCents)).toEqual([
      1_000_00, 1_000_00,
    ])
  })

  it('emits nothing for a goal with a null or zero interest rate, or a nil interest figure', () => {
    expect(
      projectedInterestIncomeInputs(
        [
          makeGoal({ id: 'g1', annual_interest_bps: null, current_balance_cents: 50_000_00 }),
          makeGoal({ id: 'g2', annual_interest_bps: 0, current_balance_cents: 50_000_00 }),
          makeGoal({ id: 'g3', annual_interest_bps: 500, current_balance_cents: 0 }),
        ],
        [],
        members,
      ),
    ).toEqual([])
  })

  it('drops a member whose split share rounds to nothing', () => {
    // 1% of $1.00 = 1 cent, split across two members → 0 / 1.
    const goal = makeGoal({ annual_interest_bps: 100, current_balance_cents: 100 })
    expect(projectedInterestIncomeInputs([goal], [], members)).toEqual([
      { memberId: 'm2', type: 'other', schedule: 'annual', amountCents: 1 },
    ])
    // No members and no owner: nothing to attribute to.
    expect(
      projectedInterestIncomeInputs(
        [makeGoal({ annual_interest_bps: 500, current_balance_cents: 20_000_00 })],
        [],
        [],
      ),
    ).toEqual([])
  })

  it('raises annual tax and moves the EOFY balance when threaded into the estimate', () => {
    const salary: Inflow = { ...baseInflow, schedule: 'annual', amount_cents: 120_000_00 }
    const interest = projectedInterestIncomeInputs(
      [makeGoal({ annual_interest_bps: 500, current_balance_cents: 100_000_00 })],
      [],
      [makeMember({ id: 'm1' })],
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
