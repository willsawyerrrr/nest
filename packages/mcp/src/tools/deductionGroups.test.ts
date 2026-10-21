import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import {
  createDeductionGroup,
  deleteDeductionGroup,
  listDeductionGroups,
  updateDeductionGroup,
} from './deductionGroups.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'
const GROUP = '2c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f'
const deduction = {
  id: ID,
  household_id: 'h-1',
  member_id: 'm-self',
  description: 'Laptop',
  amount_cents: 600_00,
  full_amount_cents: 1_000_00,
  work_use_percent: 60,
  deduction_date: '2026-10-01',
  financial_year: 2027,
  basis: 'amount',
  category: 'work_expense',
  distance_km: null,
  work_from_home_hours: null,
  group_id: null,
}

const group = {
  id: GROUP,
  household_id: 'h-1',
  member_id: 'm-self',
  financial_year: 2027,
  name: 'Adobe',
  kind: 'standard',
}

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

describe('listDeductionGroups', () => {
  it('sums each group from its payments', async () => {
    const { ctx } = fakeContext({
      tables: {
        members,
        deduction: [
          { ...deduction, group_id: GROUP },
          { ...deduction, id: 'd-2', amount_cents: 40_00, group_id: GROUP },
        ],
        deduction_group: [group],
      },
    })
    expect(await listDeductionGroups(ctx, {})).toEqual([
      {
        id: GROUP,
        member: 'Alex',
        name: 'Adobe',
        kind: 'standard',
        financial_year: 2027,
        payments: 2,
        total_cents: 640_00,
      },
    ])
  })
})

describe('deduction groups', () => {
  it('creates a standard group for the member and current year', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    expect(await createDeductionGroup(ctx, { name: 'Adobe' })).toMatchObject({
      id: 'new-id',
      kind: 'standard',
      financial_year: 2027,
    })
    expect(state.inserts[0]).toEqual({
      table: 'deduction_group',
      row: { household_id: 'h-1', member_id: 'm-self', name: 'Adobe', financial_year: 2027 },
    })
    expect(
      (
        await failure(
          createDeductionGroup(fakeContext({ tables: { members }, insertError: true }).ctx, {
            name: 'x',
          }),
        )
      ).code,
    ).toBe('save_failed')
  })

  it('renames and deletes a standard group', async () => {
    const { ctx, state } = fakeContext({ tables: { deduction_group: [group] } })
    expect(await updateDeductionGroup(ctx, { id: GROUP, name: 'Figma' })).toEqual({
      id: GROUP,
      name: 'Figma',
    })
    expect(state.updates[0]).toMatchObject({ table: 'deduction_group', row: { name: 'Figma' } })
    expect(await deleteDeductionGroup(ctx, { id: GROUP })).toEqual({ id: GROUP, deleted: true })
    expect(state.deletes[0]).toMatchObject({ table: 'deduction_group' })
  })

  it('leaves the donations group alone', async () => {
    const { ctx, state } = fakeContext({
      tables: { deduction_group: [{ ...group, kind: 'donations' }] },
    })
    expect((await failure(updateDeductionGroup(ctx, { id: GROUP, name: 'x' }))).code).toBe(
      'automatic_group',
    )
    expect((await failure(deleteDeductionGroup(ctx, { id: GROUP }))).code).toBe('automatic_group')
    expect(state.updates).toEqual([])
    expect(state.deletes).toEqual([])
  })

  it('answers not_found and save_failed', async () => {
    expect((await failure(deleteDeductionGroup(fakeContext().ctx, { id: GROUP }))).code).toBe(
      'not_found',
    )
    const { ctx } = fakeContext({
      tables: { deduction_group: [group] },
      deleteError: true,
      updateError: true,
    })
    expect((await failure(deleteDeductionGroup(ctx, { id: GROUP }))).code).toBe('delete_failed')
    expect((await failure(updateDeductionGroup(ctx, { id: GROUP, name: 'x' }))).code).toBe(
      'save_failed',
    )
  })
})
