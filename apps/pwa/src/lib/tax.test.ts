import { afterEach, describe, expect, it, vi } from 'vitest'
import { FY2027_CONFIG, type TaxBreakdown } from '@nest/tax'
import type { DeductionRow } from '../hooks/useDeductions'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { Inflow } from '../hooks/useInflows'
import type { SuperContribution } from '../hooks/useSuperContributions'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import {
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
} from './tax'

const baseInflow: Inflow = {
  id: 'i1',
  household_id: 'h1',
  member_id: 'm1',
  name: 'On-call',
  taxable: true,
  type: 'salary',
  schedule: 'every_n_weeks',
  interval_count: 4,
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
      FY2027_CONFIG,
    ).get('m1')!
    // Config cap $32,500 + $10,000 carry-forward = $42,500; $40,000 is under it.
    expect(withCarry.concessionalCapCents).toBe(42_500_00)
    expect(withCarry.concessionalOverCap).toBe(false)

    const noCarry = superCapSummaryByMember(
      [concessional],
      [baseProfile],
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
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.nonConcessionalCapCents).toBe(130_000_00)
    expect(summary.nonConcessionalOverCap).toBe(true)
    // Income below the $49,293 lower threshold: full $500 co-contribution.
    expect(summary.coContributionCents).toBe(500_00)
  })

  it('produces a zero-usage entry for a member with only a profile', () => {
    const summary = superCapSummaryByMember([], [baseProfile], new Map(), FY2027_CONFIG).get('m1')!
    expect(summary.concessionalCents).toBe(0)
    expect(summary.nonConcessionalCents).toBe(0)
    expect(summary.coContributionCents).toBe(0)
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
})

describe('netAnnualSuperContributionByMember', () => {
  it('taxes concessional and employer SG at 15% and adds after-tax amounts untaxed', () => {
    // Gross $100k → employer SG 12% = $12,000; salary sacrifice $500/fn = $13,000.
    // After-tax concessional = ($12,000 + $13,000) × 0.85 = $21,250. No non-conc.
    const grossByMember = new Map([['m1', 100_000_00]])
    const result = netAnnualSuperContributionByMember(
      [baseContribution],
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
    const result = netAnnualSuperContributionByMember([contribution], grossByMember, FY2027_CONFIG)
    expect(result.get('m1')).toBe(sgAfterTax + 1_000_00 + 500_00)
  })

  it('produces an entry from gross salary alone (employer SG, after tax)', () => {
    const grossByMember = new Map([['m1', 80_000_00]])
    const result = netAnnualSuperContributionByMember([], grossByMember, FY2027_CONFIG)
    expect(result.get('m1')).toBe(Math.round(0.12 * 80_000_00 * 0.85))
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
      netAnnualSuperContributionByMember([], new Map([['m1', 100_000_00]]), FY2027_CONFIG).get(
        'm1',
      ),
    )
  })
})

const breakdownWithRepaymentIncome = (repaymentIncomeCents: number): TaxBreakdown => ({
  taxableIncomeCents: repaymentIncomeCents,
  incomeTaxCents: 0,
  litoOffsetCents: 0,
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
