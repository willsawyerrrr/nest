import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import { addEquityGrant, deleteEquityGrant, listEquityGrants, updateEquityGrant } from './equity.ts'

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
