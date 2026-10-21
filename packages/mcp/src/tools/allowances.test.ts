import { describe, expect, it } from 'vitest'
import { failure } from '../test/failure.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import { listMemberAllowances, updateMemberAllowance } from './allowances.ts'

const ACCOUNT = '2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bee'
const allowance = {
  member_id: 'm-self',
  household_id: 'h-1',
  amount_cents: 100_00,
  frequency: 'fortnightly',
  interval_count: null,
  destination_account_id: null,
}
const tables = {
  members,
  member_allowance: [allowance, { ...allowance, member_id: 'm-other', amount_cents: 0 }],
  account_directory: [{ id: ACCOUNT }],
}

describe('listMemberAllowances', () => {
  it('names each member and normalises the amount', async () => {
    const { ctx } = fakeContext({ tables })
    const { allowances } = await listMemberAllowances(ctx)
    expect(allowances.map((a) => [a.member, a.fortnightly_cents])).toEqual([
      ['Alex', 100_00],
      ['Sam', 0],
    ])
  })
})

describe('updateMemberAllowance', () => {
  it('defaults to the signed-in member and keeps unspecified fields', async () => {
    const { ctx, state } = fakeContext({ tables })
    const result = await updateMemberAllowance(ctx, { amount_cents: 150_00 })
    expect(state.updates[0]?.row).toEqual({
      amount_cents: 150_00,
      frequency: 'fortnightly',
      interval_count: null,
      destination_account_id: null,
    })
    expect(state.updates[0]?.filters).toContainEqual(['member_id', 'm-self'])
    expect(result).toMatchObject({ member: 'Alex', amount_cents: 150_00 })
  })

  it('sets a co-member allowance, cadence, and funding account', async () => {
    const { ctx, state } = fakeContext({ tables })
    await updateMemberAllowance(ctx, {
      member: 'Sam',
      amount_cents: 40_00,
      frequency: 'every_n_weeks',
      interval_count: 3,
      destination_account_id: ACCOUNT,
    })
    expect(state.updates[0]?.row).toEqual({
      amount_cents: 40_00,
      frequency: 'every_n_weeks',
      interval_count: 3,
      destination_account_id: ACCOUNT,
    })
    expect(state.updates[0]?.filters).toContainEqual(['member_id', 'm-other'])
  })

  it('clears the funding account with null', async () => {
    const { ctx, state } = fakeContext({
      tables: {
        ...tables,
        member_allowance: [{ ...allowance, destination_account_id: ACCOUNT }],
      },
    })
    await updateMemberAllowance(ctx, { destination_account_id: null })
    expect(state.updates[0]?.row).toMatchObject({ destination_account_id: null })
  })

  it('validates the interval, member, and account', async () => {
    const { ctx } = fakeContext({ tables })
    expect((await failure(updateMemberAllowance(ctx, { frequency: 'every_n_months' }))).code).toBe(
      'invalid_details',
    )
    expect((await failure(updateMemberAllowance(ctx, { member: 'Nobody' }))).code).toBe('not_found')
    const noAccount = fakeContext({ tables: { ...tables, account_directory: [] } })
    expect(
      (await failure(updateMemberAllowance(noAccount.ctx, { destination_account_id: ACCOUNT })))
        .code,
    ).toBe('invalid_account')
  })

  it('reports an overdraw as allowance_overdrawn without upstream text', async () => {
    const { ctx } = fakeContext({
      tables,
      updateError: true,
      failureMessage: 'allowance_overdrawn',
    })
    const error = await failure(updateMemberAllowance(ctx, { amount_cents: 1 }))
    expect(error.code).toBe('allowance_overdrawn')
    expect(error.message).toBe('The allowance cannot cover what is drawn from it.')
  })

  it('reports other failures as save_failed', async () => {
    const { ctx } = fakeContext({ tables, updateError: true })
    const error = await failure(updateMemberAllowance(ctx, { amount_cents: 1 }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})
