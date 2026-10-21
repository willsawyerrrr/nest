import { describe, expect, it } from 'vitest'
import { failure } from '../test/failure.ts'
import { fakeContext } from '../test/fakeContext.ts'
import { clearPaySplit, confirmPaySplit, listPaySplits } from './paySplits.ts'

const SPEND = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'
const SAVER = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const tables = {
  account_directory: [
    { id: SPEND, name: "Alex's Spending" },
    { id: SAVER, name: 'Holiday' },
  ],
  households: [{ id: 'h-1', pay_account_id: SPEND }],
  pay_split: [
    {
      account_id: SAVER,
      household_id: 'h-1',
      confirmed_fortnightly_cents: 50_00,
      confirmed_at: '2026-10-01T00:00:00Z',
    },
  ],
}

describe('listPaySplits', () => {
  it('names the pay account and each confirmed split', async () => {
    const { ctx } = fakeContext({ tables })
    await expect(listPaySplits(ctx)).resolves.toEqual({
      pay_account_id: SPEND,
      pay_account: "Alex's Spending",
      splits: [
        {
          account_id: SAVER,
          account: 'Holiday',
          confirmed_fortnightly_cents: 50_00,
          confirmed_at: '2026-10-01T00:00:00Z',
        },
      ],
    })
  })

  it('reports no pay account', async () => {
    const { ctx } = fakeContext({
      tables: { ...tables, households: [{ id: 'h-1', pay_account_id: null }] },
    })
    expect(await listPaySplits(ctx)).toMatchObject({ pay_account_id: null, pay_account: null })
  })
})

describe('confirmPaySplit', () => {
  it('upserts the confirmed amount for the account', async () => {
    const { ctx, state } = fakeContext({ tables })
    await confirmPaySplit(ctx, { account_id: SAVER, fortnightly_cents: 75_00 })
    expect(state.upserts).toEqual([
      {
        table: 'pay_split',
        row: {
          household_id: 'h-1',
          account_id: SAVER,
          confirmed_fortnightly_cents: 75_00,
          confirmed_at: '2026-10-02T00:00:00.000Z',
        },
        onConflict: 'household_id,account_id',
      },
    ])
  })

  it('refuses an unknown account and reports a failed save', async () => {
    const none = fakeContext()
    expect(
      (await failure(confirmPaySplit(none.ctx, { account_id: SAVER, fortnightly_cents: 1 }))).code,
    ).toBe('invalid_account')
    const failing = fakeContext({ tables, upsertError: true })
    const error = await failure(
      confirmPaySplit(failing.ctx, { account_id: SAVER, fortnightly_cents: 1 }),
    )
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('clearPaySplit', () => {
  it('clears a confirmed split and refuses an unconfirmed account', async () => {
    const { ctx, state } = fakeContext({ tables })
    await expect(clearPaySplit(ctx, { account_id: SAVER })).resolves.toEqual({ account_id: SAVER })
    expect(state.deletes[0]?.table).toBe('pay_split')
    expect((await failure(clearPaySplit(ctx, { account_id: SPEND }))).code).toBe('not_found')
  })
})
