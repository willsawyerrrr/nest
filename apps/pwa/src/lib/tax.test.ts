import { describe, expect, it } from 'vitest'
import type { Inflow } from '../hooks/useInflows'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import type { SuperContribution } from '../hooks/useSuperContributions'
import { concessionalByMember, estimateHouseholdTaxFromRows } from './tax'

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
