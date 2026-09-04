import { assert, assertEquals } from '@std/assert'
import { FY2027_CONFIG } from '@nest/tax'
import {
  atPreservationAgeOn,
  estimateHouseholdTaxFromRows,
  type InflowRow,
  type TaxEstimateRows,
  toIncomeInput,
} from './tax.ts'

function inflow(overrides: Partial<InflowRow> = {}): InflowRow {
  return {
    member_id: 'm-1',
    taxable: true,
    type: 'salary',
    schedule: 'annual',
    amount_cents: 120_000_00,
    hourly_rate_cents: null,
    hours_per_period: null,
    interval_count: null,
    starts_on: null,
    ends_on: null,
    paid_on: null,
    attracts_super: true,
    one_off_tax_treatment: null,
    years_of_service: null,
    is_joint: false,
    member_split_percent: null,
    ...overrides,
  }
}

function rows(overrides: Partial<TaxEstimateRows> = {}): TaxEstimateRows {
  return {
    inflows: [inflow()],
    taxProfiles: [{ member_id: 'm-1', residency: 'resident', has_private_hospital_cover: false }],
    contributions: [],
    helpDebts: [],
    deductions: [],
    members: [{ id: 'm-1', date_of_birth: null }],
    ...overrides,
  }
}

Deno.test('estimateHouseholdTaxFromRows runs a plain salary through the engine', () => {
  const estimate = estimateHouseholdTaxFromRows(rows(), FY2027_CONFIG)
  assertEquals(estimate.annualGrossCents, 120_000_00)
  assert(estimate.annualTaxCents > 0, 'a $120k salary owes tax')
  assert(
    estimate.annualAfterTaxCents < estimate.annualGrossCents,
    'after-tax is less than gross',
  )
  assertEquals(estimate.annualOneOffGrossCents, 0)
})

Deno.test('estimateHouseholdTaxFromRows splits a joint inflow across both members', () => {
  const jointRows = rows({
    inflows: [
      inflow({ member_id: 'm-1', type: 'salary', amount_cents: 90_000_00 }),
      inflow({ member_id: 'm-2', type: 'salary', amount_cents: 90_000_00 }),
      inflow({
        member_id: 'm-1',
        type: 'other',
        amount_cents: 20_000_00,
        is_joint: true,
        member_split_percent: 50,
      }),
    ],
    taxProfiles: [
      { member_id: 'm-1', residency: 'resident', has_private_hospital_cover: false },
      { member_id: 'm-2', residency: 'resident', has_private_hospital_cover: false },
    ],
    members: [{ id: 'm-1', date_of_birth: null }, { id: 'm-2', date_of_birth: null }],
  })
  const estimate = estimateHouseholdTaxFromRows(jointRows, FY2027_CONFIG)
  const gross = (memberId: string) =>
    estimate.members.find((member) => member.memberId === memberId)!.annualGrossCents
  assertEquals(gross('m-1'), 100_000_00)
  assertEquals(gross('m-2'), 100_000_00)
})

Deno.test('estimateHouseholdTaxFromRows lets a deduction lift after-tax cash', () => {
  const base = estimateHouseholdTaxFromRows(rows(), FY2027_CONFIG)
  const withDeduction = estimateHouseholdTaxFromRows(
    rows({ deductions: [{ member_id: 'm-1', amount_cents: 5_000_00 }] }),
    FY2027_CONFIG,
  )
  assert(
    withDeduction.annualAfterTaxCents > base.annualAfterTaxCents,
    'a deduction cuts tax, so after-tax cash rises',
  )
})

Deno.test('estimateHouseholdTaxFromRows subtracts a percent-mode salary sacrifice from cash', () => {
  const base = estimateHouseholdTaxFromRows(rows(), FY2027_CONFIG)
  const sacrificed = estimateHouseholdTaxFromRows(
    rows({
      contributions: [{
        member_id: 'm-1',
        kind: 'salary_sacrifice',
        mode: 'percent',
        amount_cents: null,
        percent_bp: 1000,
        frequency: 'annual',
        interval_count: null,
      }],
    }),
    FY2027_CONFIG,
  )
  assert(
    sacrificed.annualAfterTaxCents < base.annualAfterTaxCents,
    '10% of a $120k salary diverted pre-tax lowers take-home cash',
  )
  assert(
    sacrificed.annualConcessionalContributionsCents > 0,
    'the concessional contribution is recorded',
  )
})

Deno.test('estimateHouseholdTaxFromRows assesses a genuine redundancy as one-off money', () => {
  const estimate = estimateHouseholdTaxFromRows(
    rows({
      inflows: [
        inflow(),
        inflow({
          type: 'other',
          schedule: null,
          amount_cents: 80_000_00,
          paid_on: '2027-02-01',
          one_off_tax_treatment: 'genuine_redundancy',
          years_of_service: 4,
          attracts_super: false,
        }),
      ],
    }),
    FY2027_CONFIG,
  )
  assert(estimate.annualOneOffGrossCents > 0, 'the redundancy is one-off gross')
  assert(
    estimate.annualOneOffAfterTaxCents > 0 &&
      estimate.annualOneOffAfterTaxCents <= estimate.annualOneOffGrossCents,
    'its after-tax value is a real fraction of the gross',
  )
})

Deno.test('estimateHouseholdTaxFromRows synthesises a profile for a HELP-only member', () => {
  const estimate = estimateHouseholdTaxFromRows(
    rows({ taxProfiles: [], helpDebts: [{ member_id: 'm-1', balance_cents: 20_000_00 }] }),
    FY2027_CONFIG,
  )
  assertEquals(estimate.members.length, 1)
  assert(
    estimate.members[0].breakdown.helpRepaymentCents > 0,
    'a member with a HELP balance but no profile still has a repayment assessed',
  )
})

Deno.test('toIncomeInput coerces an unknown inflow type to other and carries a one-off', () => {
  assertEquals(toIncomeInput(inflow({ type: 'reimbursement' })).type, 'other')
  const oneOff = toIncomeInput(
    inflow({
      schedule: null,
      paid_on: '2027-05-01',
      one_off_tax_treatment: 'employment_termination',
    }),
    true,
  )
  assertEquals(oneOff.paidOn, '2027-05-01')
  assertEquals(oneOff.treatment, 'employmentTermination')
  assertEquals(oneOff.atPreservationAge, true)
})

Deno.test('atPreservationAgeOn reads an unknown date of birth as below the age', () => {
  assertEquals(atPreservationAgeOn(null, '2027-01-01', FY2027_CONFIG), false)
  const old = `${2027 - FY2027_CONFIG.super.preservationAge - 1}-01-01`
  assertEquals(atPreservationAgeOn(old, '2027-06-01', FY2027_CONFIG), true)
  const young = `${2027 - FY2027_CONFIG.super.preservationAge + 5}-01-01`
  assertEquals(atPreservationAgeOn(young, '2027-06-01', FY2027_CONFIG), false)
})
