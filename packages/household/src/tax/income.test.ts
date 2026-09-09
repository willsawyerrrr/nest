import { describe, expect, it } from 'vitest'
import type { InflowRow } from '../rows.ts'
import { inflowIncomeInputs, splitAcrossMembers, splitByPercent, toIncomeInput } from '../tax.ts'

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

/** A taxable one-off severance for `m1`, paid inside FY2027. */
const severance = inflow({
  schedule: null,
  interval_count: null,
  paid_on: '2026-09-12',
  one_off_tax_treatment: 'ordinary',
  amount_cents: 40_000_00,
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
