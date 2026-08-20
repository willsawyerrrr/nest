import { afterEach, describe, expect, it, vi } from 'vitest'
import { fortnightlyCents } from '@nest/plan'
import { annualGrossCents, FY2027_CONFIG, type TaxBreakdown } from '@nest/tax'
import type { DeductionRow } from '../hooks/useDeductions'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { Inflow } from '../hooks/useInflows'
import type { SuperContribution } from '../hooks/useSuperContributions'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import { makeMember } from '../test/fixtures'
import {
  atPreservationAgeOn,
  concessionalByMember,
  currentTaxConfig,
  deductionsByMember,
  estimateHouseholdTaxFromRows,
  helpDebtCentsByMember,
  helpPayoffByMember,
  helpPayoffForBreakdown,
  helpPayoffSummary,
  netAnnualSuperContributionByMember,
  netAnnualSuperContributionFromRows,
  nonConcessionalByMember,
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
  amount_cents: 300_00,
  hourly_rate_cents: null,
  hours_per_period: null,
  starts_on: null,
  ends_on: null,
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
