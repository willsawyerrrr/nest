import { describe, expect, it } from 'vitest'
import { fortnightlyCents } from '@nest/plan'
import { annualGrossCents } from '@nest/tax'
import type {
  DeductionRow,
  HelpDebtRow,
  InflowRow,
  SuperContributionRow,
  SuperProfileRow,
  TaxProfileRow,
} from '../rows.ts'
import { estimateHouseholdTaxFromRows, superCapSummaryFromRows, toIncomeInput } from '../tax.ts'

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

/** A taxable one-off severance for `m1`, paid inside FY2027. */
const severance = inflow({
  schedule: null,
  interval_count: null,
  paid_on: '2026-09-12',
  one_off_tax_treatment: 'ordinary',
  amount_cents: 40_000_00,
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
