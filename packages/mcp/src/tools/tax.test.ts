import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext } from '../test/fakeContext.ts'
import {
  getTaxEstimate,
  listHelpDebts,
  listTaxProfiles,
  setHelpDebt,
  setTaxProfile,
} from './tax.ts'

const people = [
  { id: 'm-self', name: 'Alex', date_of_birth: '1990-05-01' },
  { id: 'm-other', name: 'Sam', date_of_birth: null },
]

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

describe('listTaxProfiles', () => {
  it("lists each member's profile for the financial year, null where there is none", async () => {
    const { ctx } = fakeContext({
      tables: {
        members: people,
        tax_profile: [
          {
            member_id: 'm-self',
            financial_year: 2027,
            residency: 'resident',
            has_private_hospital_cover: true,
          },
          {
            member_id: 'm-other',
            financial_year: 2026,
            residency: 'foreign_resident',
            has_private_hospital_cover: false,
          },
        ],
      },
    })
    const result = await listTaxProfiles(ctx, {})
    expect(result.financial_year).toBe(2027)
    expect(result.members).toEqual([
      {
        member_id: 'm-self',
        member: 'Alex',
        date_of_birth: '1990-05-01',
        residency: 'resident',
        has_private_hospital_cover: true,
      },
      {
        member_id: 'm-other',
        member: 'Sam',
        date_of_birth: null,
        residency: null,
        has_private_hospital_cover: null,
      },
    ])
    expect((await listTaxProfiles(ctx, { financial_year: 2026 })).members[1]?.residency).toBe(
      'foreign_resident',
    )
  })
})

describe('setTaxProfile', () => {
  it('upserts a new profile as a resident without cover, for the signed-in member', async () => {
    const { ctx, state } = fakeContext({ tables: { members: people } })
    await setTaxProfile(ctx, {})
    expect(state.upserts).toEqual([
      {
        table: 'tax_profile',
        row: {
          household_id: 'h-1',
          member_id: 'm-self',
          financial_year: 2027,
          residency: 'resident',
          has_private_hospital_cover: false,
        },
        onConflict: 'member_id,financial_year',
      },
    ])
  })

  it('changes only the fields given on an existing profile', async () => {
    const { ctx, state } = fakeContext({
      tables: {
        members: people,
        tax_profile: [
          {
            member_id: 'm-other',
            financial_year: 2027,
            residency: 'foreign_resident',
            has_private_hospital_cover: false,
          },
        ],
      },
    })
    await setTaxProfile(ctx, { member: 'sam', has_private_hospital_cover: true })
    expect(state.upserts[0]?.row).toMatchObject({
      member_id: 'm-other',
      residency: 'foreign_resident',
      has_private_hospital_cover: true,
    })
  })

  it('reports an unknown member and a failed save', async () => {
    const { ctx } = fakeContext({ tables: { members: people } })
    expect((await failure(setTaxProfile(ctx, { member: 'Nobody' }))).code).toBe('not_found')
    const failing = fakeContext({ tables: { members: people }, upsertError: true })
    expect((await failure(setTaxProfile(failing.ctx, {}))).code).toBe('save_failed')
  })
})

describe('help debts', () => {
  it('lists every member with zero where none is recorded', async () => {
    const { ctx } = fakeContext({
      tables: { members: people, help_debt: [{ member_id: 'm-other', balance_cents: 20_000_00 }] },
    })
    expect((await listHelpDebts(ctx)).help_debts).toEqual([
      { member_id: 'm-self', member: 'Alex', balance_cents: 0 },
      { member_id: 'm-other', member: 'Sam', balance_cents: 20_000_00 },
    ])
  })

  it('upserts the standing balance keyed by member', async () => {
    const { ctx, state } = fakeContext({ tables: { members: people } })
    await setHelpDebt(ctx, { member: 'Sam', balance_cents: 15_000_00 })
    expect(state.upserts).toEqual([
      {
        table: 'help_debt',
        row: { household_id: 'h-1', member_id: 'm-other', balance_cents: 15_000_00 },
        onConflict: 'member_id',
      },
    ])
  })

  it('reports a failed save with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { members: people }, upsertError: true })
    const error = await failure(setHelpDebt(ctx, { balance_cents: 1 }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('getTaxEstimate', () => {
  const salary = {
    member_id: 'm-self',
    taxable: true,
    type: 'salary',
    schedule: 'annual',
    amount_cents: 100_000_00,
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
  }

  it("estimates each member's tax from the rows they can see", async () => {
    const { ctx } = fakeContext({
      tables: {
        members: people,
        inflows: [salary],
        deduction: [{ member_id: 'm-self', financial_year: 2027, amount_cents: 2_000_00 }],
      },
    })
    const result = await getTaxEstimate(ctx, {})
    expect(result.financial_year).toBe(2027)
    expect(result.annual_gross_cents).toBe(100_000_00)
    expect(result.annual_deductions_cents).toBe(2_000_00)
    expect(result.members).toHaveLength(1)
    expect(result.members[0]).toMatchObject({
      member: 'Alex',
      taxable_income_cents: 98_000_00,
    })
    expect(result.annual_tax_cents).toBeGreaterThan(0)
    expect(result.annual_after_tax_cents).toBe(result.annual_gross_cents - result.annual_tax_cents)
  })

  it('refuses a year with no published tax configuration', async () => {
    const { ctx } = fakeContext({ tables: { members: people } })
    expect((await failure(getTaxEstimate(ctx, { financial_year: 2010 }))).code).toBe(
      'invalid_details',
    )
  })
})
