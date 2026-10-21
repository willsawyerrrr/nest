import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import {
  addSuperContribution,
  deleteSuperContribution,
  listSuperContributions,
  listSuperProfiles,
  setSuperProfile,
  updateSuperContribution,
} from './superannuation.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'

const contribution = {
  id: ID,
  household_id: 'h-1',
  member_id: 'm-self',
  financial_year: 2027,
  kind: 'salary_sacrifice',
  mode: 'amount',
  amount_cents: 500_00,
  percent_bp: null,
  frequency: 'fortnightly',
  interval_count: null,
  fhss_eligible: false,
  contributor_member_id: null,
}

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

describe('listSuperProfiles', () => {
  it("lists each member's fund with the linked account's balance", async () => {
    const { ctx } = fakeContext({
      tables: {
        members,
        super_profile: [
          {
            member_id: 'm-self',
            financial_year: 2027,
            fund_name: 'AustralianSuper',
            linked_account_id: 'a-1',
            balance_as_of: '2026-09-30',
            carry_forward_cap_cents: 10_000_00,
            sg_rate_override: null,
          },
        ],
        accounts_with_balance: [{ id: 'a-1', balance_cents: 80_000_00 }],
      },
    })
    expect((await listSuperProfiles(ctx, {})).profiles).toEqual([
      {
        member_id: 'm-self',
        member: 'Alex',
        fund_name: 'AustralianSuper',
        linked_account_id: 'a-1',
        balance_cents: 80_000_00,
        balance_as_of: '2026-09-30',
        carry_forward_cap_cents: 10_000_00,
        sg_rate_override: null,
      },
      {
        member_id: 'm-other',
        member: 'Sam',
        fund_name: null,
        linked_account_id: null,
        balance_cents: null,
        balance_as_of: null,
        carry_forward_cap_cents: 0,
        sg_rate_override: null,
      },
    ])
  })
})

describe('setSuperProfile', () => {
  it('creates and links a manual account, then records the balance and the true-up', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    const result = await setSuperProfile(ctx, { balance_cents: 50_000_00 })
    expect(state.inserts).toEqual([
      {
        table: 'accounts',
        row: {
          household_id: 'h-1',
          source: 'manual',
          type: 'savings',
          owner_member_id: 'm-self',
          name: 'Alex Super',
        },
      },
    ])
    expect(state.upserts).toEqual([
      {
        table: 'account_balance',
        row: { account_id: 'new-id', household_id: 'h-1', balance_cents: 50_000_00 },
        onConflict: 'account_id',
      },
      {
        table: 'super_profile',
        row: {
          household_id: 'h-1',
          member_id: 'm-self',
          financial_year: 2027,
          fund_name: null,
          linked_account_id: 'new-id',
          balance_as_of: '2026-10-02',
        },
        onConflict: 'member_id,financial_year',
      },
    ])
    expect(result).toMatchObject({ linked_account_id: 'new-id', balance_as_of: '2026-10-02' })
  })

  it('renames the linked account, keeping or clearing the fund name', async () => {
    const profile = {
      member_id: 'm-self',
      financial_year: 2027,
      fund_name: 'Hostplus',
      linked_account_id: 'a-1',
    }
    const kept = fakeContext({
      tables: { members, super_profile: [profile], accounts: [{ id: 'a-1', household_id: 'h-1' }] },
    })
    await setSuperProfile(kept.ctx, { balance_cents: 1_00 })
    expect(kept.state.inserts).toEqual([])
    expect(kept.state.updates[0]?.row).toEqual({ name: 'Hostplus' })
    expect(kept.state.upserts[1]?.row).toMatchObject({
      fund_name: 'Hostplus',
      linked_account_id: 'a-1',
    })

    const cleared = fakeContext({
      tables: { members, super_profile: [profile], accounts: [{ id: 'a-1', household_id: 'h-1' }] },
    })
    await setSuperProfile(cleared.ctx, { balance_cents: 1_00, fund_name: null })
    expect(cleared.state.updates[0]?.row).toEqual({ name: 'Alex Super' })
    expect(cleared.state.upserts[1]?.row).toMatchObject({ fund_name: null })
  })

  it('reports a failed save with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { members }, upsertError: true })
    const error = await failure(setSuperProfile(ctx, { balance_cents: 1 }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
    const inserting = fakeContext({ tables: { members }, insertError: true })
    expect((await failure(setSuperProfile(inserting.ctx, { balance_cents: 1 }))).code).toBe(
      'save_failed',
    )
  })
})

describe('listSuperContributions', () => {
  it("lists the year's contributions by member name, optionally for one member", async () => {
    const { ctx } = fakeContext({
      tables: {
        members,
        super_contribution: [
          contribution,
          {
            ...contribution,
            id: 'c-2',
            member_id: 'm-other',
            kind: 'spouse',
            contributor_member_id: 'm-self',
          },
          { ...contribution, id: 'c-3', financial_year: 2026 },
        ],
      },
    })
    const all = await listSuperContributions(ctx, {})
    expect(all.contributions.map((row) => [row.id, row.member, row.contributor])).toEqual([
      [ID, 'Alex', null],
      ['c-2', 'Sam', 'Alex'],
    ])
    expect((await listSuperContributions(ctx, { member: 'Sam' })).contributions).toHaveLength(1)
  })
})

describe('addSuperContribution', () => {
  const base = {
    kind: 'salary_sacrifice',
    mode: 'amount',
    amount_cents: 500_00,
    frequency: 'fortnightly',
  } as const

  it('inserts an amount contribution for the signed-in member in the current year', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await addSuperContribution(ctx, base)
    expect(state.inserts).toEqual([
      {
        table: 'super_contribution',
        row: {
          household_id: 'h-1',
          member_id: 'm-self',
          financial_year: 2027,
          kind: 'salary_sacrifice',
          mode: 'amount',
          amount_cents: 500_00,
          percent_bp: null,
          frequency: 'fortnightly',
          interval_count: null,
          fhss_eligible: false,
          contributor_member_id: null,
        },
      },
    ])
  })

  it('adds a percent contribution and holds each mode to its own figure', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await addSuperContribution(ctx, {
      kind: 'personal_deductible',
      mode: 'percent',
      percent_bp: 500,
      frequency: 'annual',
    })
    expect(state.inserts[0]?.row).toMatchObject({
      mode: 'percent',
      percent_bp: 500,
      amount_cents: null,
    })
    expect((await failure(addSuperContribution(ctx, { ...base, mode: 'percent' }))).code).toBe(
      'invalid_details',
    )
    expect((await failure(addSuperContribution(ctx, { ...base, percent_bp: 5 }))).code).toBe(
      'invalid_details',
    )
    expect(
      (
        await failure(
          addSuperContribution(ctx, {
            kind: 'salary_sacrifice',
            mode: 'amount',
            frequency: 'annual',
          }),
        )
      ).code,
    ).toBe('invalid_details')
  })

  it('requires a different member as the contributor of a spouse contribution, and only then', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    const spouse = { ...base, kind: 'spouse' } as const
    expect((await failure(addSuperContribution(ctx, spouse))).code).toBe('invalid_details')
    expect(
      (await failure(addSuperContribution(ctx, { ...spouse, contributor: 'Alex' }))).code,
    ).toBe('invalid_details')
    await addSuperContribution(ctx, { ...spouse, contributor: 'Sam' })
    expect(state.inserts[0]?.row).toMatchObject({ contributor_member_id: 'm-other' })
    expect((await failure(addSuperContribution(ctx, { ...base, contributor: 'Sam' }))).code).toBe(
      'invalid_details',
    )
  })

  it('requires an interval count for an every-N frequency only', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    expect(
      (await failure(addSuperContribution(ctx, { ...base, frequency: 'every_n_weeks' }))).code,
    ).toBe('invalid_details')
    expect((await failure(addSuperContribution(ctx, { ...base, interval_count: 2 }))).code).toBe(
      'invalid_details',
    )
    await expect(
      addSuperContribution(ctx, { ...base, frequency: 'every_n_months', interval_count: 3 }),
    ).resolves.toMatchObject({ interval_count: 3 })
  })

  it('reports a failed insert with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { members }, insertError: true })
    expect((await failure(addSuperContribution(ctx, base))).code).toBe('save_failed')
  })
})

describe('updateSuperContribution', () => {
  it('changes only the given fields', async () => {
    const { ctx, state } = fakeContext({ tables: { super_contribution: [contribution], members } })
    await updateSuperContribution(ctx, { id: ID, amount_cents: 600_00, fhss_eligible: true })
    const { id: _id, household_id: _household, ...columns } = contribution
    expect(state.updates[0]).toMatchObject({
      table: 'super_contribution',
      row: { ...columns, amount_cents: 600_00, fhss_eligible: true },
      filters: [
        ['id', ID],
        ['household_id', 'h-1'],
      ],
    })
  })

  it('switches mode only with the new mode figure, dropping the old one', async () => {
    const { ctx, state } = fakeContext({ tables: { super_contribution: [contribution], members } })
    expect((await failure(updateSuperContribution(ctx, { id: ID, mode: 'percent' }))).code).toBe(
      'invalid_details',
    )
    await updateSuperContribution(ctx, { id: ID, mode: 'percent', percent_bp: 1_000 })
    expect(state.updates[0]?.row).toMatchObject({
      mode: 'percent',
      percent_bp: 1_000,
      amount_cents: null,
    })
  })

  it('drops the contributor when the kind stops being spouse and the count on a fixed frequency', async () => {
    const spouse = {
      ...contribution,
      kind: 'spouse',
      contributor_member_id: 'm-other',
      frequency: 'every_n_weeks',
      interval_count: 3,
    }
    const { ctx, state } = fakeContext({ tables: { super_contribution: [spouse], members } })
    expect(
      (
        await failure(
          updateSuperContribution(ctx, { id: ID, contributor: 'Sam', kind: 'salary_sacrifice' }),
        )
      ).code,
    ).toBe('invalid_details')
    await updateSuperContribution(ctx, { id: ID, kind: 'salary_sacrifice', frequency: 'weekly' })
    expect(state.updates[0]?.row).toMatchObject({
      kind: 'salary_sacrifice',
      contributor_member_id: null,
      frequency: 'weekly',
      interval_count: null,
    })
  })

  it('reports an unknown contribution as not found and a failed update with fixed copy', async () => {
    expect(
      (await failure(updateSuperContribution(fakeContext().ctx, { id: ID, amount_cents: 1 }))).code,
    ).toBe('not_found')
    const { ctx } = fakeContext({
      tables: { super_contribution: [contribution], members },
      updateError: true,
    })
    expect((await failure(updateSuperContribution(ctx, { id: ID, amount_cents: 1 }))).code).toBe(
      'save_failed',
    )
  })
})

describe('deleteSuperContribution', () => {
  it('deletes by id within the household', async () => {
    const { ctx, state } = fakeContext({ tables: { super_contribution: [contribution] } })
    await expect(deleteSuperContribution(ctx, { id: ID })).resolves.toEqual({
      id: ID,
      deleted: true,
    })
    expect(state.deletes[0]?.table).toBe('super_contribution')
  })

  it('reports an unknown contribution as not found', async () => {
    expect((await failure(deleteSuperContribution(fakeContext().ctx, { id: ID }))).code).toBe(
      'not_found',
    )
  })
})
