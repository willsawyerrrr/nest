import { describe, expect, it } from 'vitest'
import { FY2027_CONFIG } from '@budget/tax'
import type { Inflow } from '../hooks/useInflows'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import type { SuperContribution } from '../hooks/useSuperContributions'
import {
  concessionalByMember,
  estimateHouseholdTaxFromRows,
  netAnnualSuperContributionByMember,
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
  interval_weeks: 4,
  amount_cents: 300_00,
  hourly_rate_cents: null,
  hours_per_period: null,
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
  help_debt_cents: 0,
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
  interval_weeks: null,
  fhss_eligible: false,
  contributor_member_id: null,
  created_at: '',
  updated_at: '',
}

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
      interval_weeks: null,
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

  it('annualises an every-N-weeks taxable inflow via the shared normalization', () => {
    // $300 every 4 weeks → round(300_00 × 52 / 4) = 3_900_00/yr.
    const estimate = estimateHouseholdTaxFromRows([baseInflow], [profile])
    expect(estimate.annualGrossCents).toBe(3_900_00)
  })

  it('matches the fortnightly case when the interval is 2 weeks', () => {
    const everyTwoWeeks = estimateHouseholdTaxFromRows(
      [{ ...baseInflow, schedule: 'every_n_weeks', interval_weeks: 2 }],
      [profile],
    )
    const fortnightly = estimateHouseholdTaxFromRows(
      [{ ...baseInflow, schedule: 'fortnightly', interval_weeks: null }],
      [profile],
    )
    expect(everyTwoWeeks.annualGrossCents).toBe(fortnightly.annualGrossCents)
    expect(everyTwoWeeks.annualTaxCents).toBe(fortnightly.annualTaxCents)
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
      interval_weeks: null,
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
