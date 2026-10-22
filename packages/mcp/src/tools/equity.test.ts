import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import {
  addEquityGrant,
  deleteEquityGrant,
  listEquityGrants,
  recordEquityExercise,
  recordEquitySale,
  updateEquityGrant,
} from './equity.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'

const grant = {
  id: ID,
  household_id: 'h-1',
  member_id: 'm-self',
  label: 'Seed options',
  instrument_type: 'option',
  quantity: 4_800,
  grant_date: '2024-10-02',
  cliff_months: 12,
  vesting_period_months: 48,
  vesting_frequency: 'monthly',
  strike_price_cents: 1_00,
  price_per_share_cents: 5_00,
  price_as_of: '2026-09-01',
}

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

describe('listEquityGrants', () => {
  it('values the vested portion as of today', async () => {
    const { ctx } = fakeContext({ tables: { equity_grant: [grant], members } })
    const result = await listEquityGrants(ctx)
    // 24 of 48 months elapsed: 2,400 options vested at a 4 dollar gain each.
    expect(result.grants[0]).toMatchObject({
      member: 'Alex',
      vested_quantity: 2_400,
      vested_value_cents: 2_400 * 4_00,
    })
    expect(result.total_vested_value_cents).toBe(9_600_00)
  })
})

describe('exercises and sales', () => {
  it('values unexercised options as options and exercised shares as shares', async () => {
    const { ctx } = fakeContext({
      tables: {
        equity_grant: [grant],
        members,
        equity_exercise: [{ id: 'x1', grant_id: ID, quantity: 1_000 }],
        equity_sale: [{ id: 's1', grant_id: ID, quantity: 400 }],
      },
    })
    const result = await listEquityGrants(ctx)
    // 2,400 vested: 1,400 still options at $4 gain; 600 shares held at $5.
    expect(result.grants[0]).toMatchObject({
      exercised_quantity: 1_000,
      sold_quantity: 400,
      unexercised_vested_quantity: 1_400,
      held_share_quantity: 600,
      vested_value_cents: 1_400 * 4_00 + 600 * 5_00,
    })
  })

  it('records an exercise at the grant strike for the grant owner', async () => {
    const { ctx, state } = fakeContext({ tables: { equity_grant: [grant], members } })
    await recordEquityExercise(ctx, { grant_id: ID, exercised_on: '2026-09-01', quantity: 100 })
    expect(state.inserts[0]).toEqual({
      table: 'equity_exercise',
      row: {
        household_id: 'h-1',
        member_id: 'm-self',
        grant_id: ID,
        exercised_on: '2026-09-01',
        quantity: 100,
        strike_price_cents: 1_00,
        market_price_per_share_cents: null,
      },
    })
  })

  it('refuses an exercise beyond the grant or on a share grant', async () => {
    const { ctx } = fakeContext({
      tables: {
        equity_grant: [grant, { ...grant, id: 'sh', instrument_type: 'share' }],
        equity_exercise: [{ id: 'x1', grant_id: ID, quantity: 4_700 }],
      },
    })
    const over = await failure(
      recordEquityExercise(ctx, { grant_id: ID, exercised_on: '2026-09-01', quantity: 101 }),
    )
    expect(over.code).toBe('invalid_details')
    const shares = await failure(
      recordEquityExercise(ctx, { grant_id: 'sh', exercised_on: '2026-09-01', quantity: 1 }),
    )
    expect(shares.code).toBe('invalid_details')
  })

  it('records a sale within the shares held and refuses more', async () => {
    const { ctx, state } = fakeContext({
      tables: {
        equity_grant: [grant],
        equity_exercise: [{ id: 'x1', grant_id: ID, quantity: 500 }],
        equity_sale: [{ id: 's1', grant_id: ID, quantity: 200 }],
      },
    })
    await recordEquitySale(ctx, {
      grant_id: ID,
      sold_on: '2026-09-02',
      quantity: 300,
      price_per_share_cents: 5_00,
      fee_cents: 9_95,
    })
    expect(state.inserts[0]?.table).toBe('equity_sale')
    expect(state.inserts[0]?.row).toMatchObject({ quantity: 300, fee_cents: 9_95 })
    const error = await failure(
      recordEquitySale(ctx, {
        grant_id: ID,
        sold_on: '2026-09-02',
        quantity: 301,
        price_per_share_cents: 5_00,
      }),
    )
    expect(error.code).toBe('invalid_details')
  })

  it('rejects an unknown grant', async () => {
    const { ctx } = fakeContext({ tables: { equity_grant: [grant] } })
    const error = await failure(
      recordEquitySale(ctx, {
        grant_id: '00000000-0000-4000-8000-000000000000',
        sold_on: '2026-09-02',
        quantity: 1,
        price_per_share_cents: 1,
      }),
    )
    expect(error.code).toBe('not_found')
  })
})

describe('addEquityGrant', () => {
  it('inserts an option grant with the form defaults', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await addEquityGrant(ctx, {
      label: 'Seed options',
      instrument_type: 'option',
      quantity: 4_800,
      grant_date: '2024-10-02',
      strike_price_cents: 1_00,
    })
    expect(state.inserts).toEqual([
      {
        table: 'equity_grant',
        row: {
          household_id: 'h-1',
          member_id: 'm-self',
          label: 'Seed options',
          instrument_type: 'option',
          quantity: 4_800,
          grant_date: '2024-10-02',
          cliff_months: 12,
          vesting_period_months: 48,
          vesting_frequency: 'monthly',
          strike_price_cents: 1_00,
          price_per_share_cents: 0,
          price_as_of: null,
        },
      },
    ])
  })

  it("adds a member's share grant and refuses a strike price on shares", async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    const shares = {
      label: 'Shares',
      instrument_type: 'share',
      quantity: 100,
      grant_date: '2025-01-01',
    } as const
    await addEquityGrant(ctx, {
      ...shares,
      member: 'Sam',
      vesting_frequency: 'quarterly',
      price_per_share_cents: 2_50,
    })
    expect(state.inserts[0]?.row).toMatchObject({
      member_id: 'm-other',
      strike_price_cents: null,
      vesting_frequency: 'quarterly',
      price_per_share_cents: 2_50,
    })
    expect((await failure(addEquityGrant(ctx, { ...shares, strike_price_cents: 1 }))).code).toBe(
      'invalid_details',
    )
  })

  it('reports an unknown member and a failed insert with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    const input = {
      label: 'A',
      instrument_type: 'share',
      quantity: 1,
      grant_date: '2025-01-01',
    } as const
    expect((await failure(addEquityGrant(ctx, { ...input, member: 'Nobody' }))).code).toBe(
      'not_found',
    )
    const failing = fakeContext({ tables: { members }, insertError: true })
    const error = await failure(addEquityGrant(failing.ctx, input))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('updateEquityGrant', () => {
  it('changes only the given fields', async () => {
    const { ctx, state } = fakeContext({ tables: { equity_grant: [grant], members } })
    await updateEquityGrant(ctx, { id: ID, price_per_share_cents: 6_00, price_as_of: '2026-10-01' })
    const { id: _id, household_id: _household, ...columns } = grant
    expect(state.updates[0]).toMatchObject({
      table: 'equity_grant',
      row: { ...columns, price_per_share_cents: 6_00, price_as_of: '2026-10-01' },
      filters: [
        ['id', ID],
        ['household_id', 'h-1'],
      ],
    })
  })

  it('clears the strike and date with null, and drops the strike when it becomes shares', async () => {
    const { ctx, state } = fakeContext({ tables: { equity_grant: [grant], members } })
    await updateEquityGrant(ctx, { id: ID, strike_price_cents: null, price_as_of: null })
    expect(state.updates[0]?.row).toMatchObject({ strike_price_cents: null, price_as_of: null })
    await updateEquityGrant(ctx, { id: ID, instrument_type: 'share' })
    expect(state.updates[1]?.row).toMatchObject({
      instrument_type: 'share',
      strike_price_cents: null,
    })
    expect(
      (
        await failure(
          updateEquityGrant(ctx, { id: ID, instrument_type: 'share', strike_price_cents: 5 }),
        )
      ).code,
    ).toBe('invalid_details')
  })

  it('reports an unknown grant as not found and a failed update with fixed copy', async () => {
    expect(
      (await failure(updateEquityGrant(fakeContext().ctx, { id: ID, quantity: 1 }))).code,
    ).toBe('not_found')
    const { ctx } = fakeContext({ tables: { equity_grant: [grant], members }, updateError: true })
    expect((await failure(updateEquityGrant(ctx, { id: ID, quantity: 1 }))).code).toBe(
      'save_failed',
    )
  })
})

describe('deleteEquityGrant', () => {
  it('deletes by id within the household', async () => {
    const { ctx, state } = fakeContext({ tables: { equity_grant: [grant] } })
    await expect(deleteEquityGrant(ctx, { id: ID })).resolves.toEqual({ id: ID, deleted: true })
    expect(state.deletes[0]?.table).toBe('equity_grant')
  })

  it('reports an unknown grant as not found and a failure with fixed copy', async () => {
    expect((await failure(deleteEquityGrant(fakeContext().ctx, { id: ID }))).code).toBe('not_found')
    const { ctx } = fakeContext({ tables: { equity_grant: [grant] }, deleteError: true })
    expect((await failure(deleteEquityGrant(ctx, { id: ID }))).code).toBe('save_failed')
  })
})
