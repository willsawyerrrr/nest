import { describe, expect, it } from 'vitest'
import { failure } from '../test/failure.ts'
import { fakeContext } from '../test/fakeContext.ts'
import {
  addSavingsGoal,
  deleteSavingsGoal,
  reorderSavingsGoalQueue,
  updateSavingsGoal,
} from './goals.ts'

const G1 = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'
const G2 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const G3 = '3d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bef'
const SAVER = '2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bee'
const goal = {
  id: G1,
  household_id: 'h-1',
  name: 'Trip',
  target_amount_cents: 5_000_00,
  target_date: '2027-06-30',
  current_balance_cents: 100_00,
  linked_account_id: null,
  annual_interest_bps: 450,
  queue_position: null,
  planned_contribution_cents: null,
}
const saver = { id: SAVER, type: 'savings', source: 'up' }

describe('addSavingsGoal', () => {
  it('creates a goal with optional modelling fields', async () => {
    const { ctx, state } = fakeContext({ tables: { accounts_with_balance: [saver] } })
    const result = await addSavingsGoal(ctx, {
      name: 'Trip',
      target_amount_cents: 5_000_00,
      target_date: '2027-06-30',
      linked_account_id: SAVER,
      annual_interest_bps: 450,
      planned_contribution_cents: 50_00,
    })
    expect(state.inserts[0]).toEqual({
      table: 'savings_goal',
      row: {
        household_id: 'h-1',
        name: 'Trip',
        target_amount_cents: 5_000_00,
        target_date: '2027-06-30',
        current_balance_cents: 0,
        linked_account_id: SAVER,
        annual_interest_bps: 450,
        queue_position: null,
        planned_contribution_cents: 50_00,
      },
    })
    expect(result.id).toBe('new-id')
  })

  it('refuses a link to anything but a synced saver', async () => {
    for (const row of [
      undefined,
      { ...saver, type: 'transaction' },
      { ...saver, source: 'manual' },
    ]) {
      const { ctx } = fakeContext({ tables: { accounts_with_balance: row ? [row] : [] } })
      const error = await failure(
        addSavingsGoal(ctx, { name: 'T', target_amount_cents: 1, linked_account_id: SAVER }),
      )
      expect(error.code).toBe('invalid_account')
    }
  })

  it('reports a failed insert with fixed copy', async () => {
    const { ctx } = fakeContext({ insertError: true })
    const error = await failure(addSavingsGoal(ctx, { name: 'T', target_amount_cents: 1 }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('updateSavingsGoal', () => {
  it('changes only the fields given', async () => {
    const { ctx, state } = fakeContext({ tables: { savings_goal: [goal] } })
    await updateSavingsGoal(ctx, { id: G1, current_balance_cents: 250_00 })
    expect(state.updates[0]?.row).toEqual({
      name: 'Trip',
      target_amount_cents: 5_000_00,
      target_date: '2027-06-30',
      current_balance_cents: 250_00,
      linked_account_id: null,
      annual_interest_bps: 450,
      queue_position: null,
      planned_contribution_cents: null,
    })
  })

  it('clears nullable fields with null and links a saver', async () => {
    const { ctx, state } = fakeContext({
      tables: { savings_goal: [goal], accounts_with_balance: [saver] },
    })
    await updateSavingsGoal(ctx, {
      id: G1,
      target_date: null,
      annual_interest_bps: null,
      linked_account_id: SAVER,
    })
    expect(state.updates[0]?.row).toMatchObject({
      target_date: null,
      annual_interest_bps: null,
      linked_account_id: SAVER,
    })
  })

  it('refuses an unknown goal and a failed save', async () => {
    const none = fakeContext()
    expect((await failure(updateSavingsGoal(none.ctx, { id: G1, name: 'X' }))).code).toBe(
      'not_found',
    )
    const failing = fakeContext({ tables: { savings_goal: [goal] }, updateError: true })
    expect((await failure(updateSavingsGoal(failing.ctx, { id: G1, name: 'X' }))).code).toBe(
      'save_failed',
    )
  })
})

describe('deleteSavingsGoal', () => {
  it('deletes a goal and refuses an unknown one', async () => {
    const { ctx, state } = fakeContext({ tables: { savings_goal: [goal] } })
    await expect(deleteSavingsGoal(ctx, { id: G1 })).resolves.toEqual({ id: G1 })
    expect(state.deletes[0]?.table).toBe('savings_goal')
    const none = fakeContext()
    expect((await failure(deleteSavingsGoal(none.ctx, { id: G1 }))).code).toBe('not_found')
  })
})

describe('reorderSavingsGoalQueue', () => {
  const tables = {
    savings_goal: [
      { ...goal, id: G1, queue_position: 0 },
      { ...goal, id: G2, queue_position: 1 },
      { ...goal, id: G3, queue_position: null },
    ],
  }

  it('writes only the goals whose position changed', async () => {
    const { ctx, state } = fakeContext({ tables })
    const result = await reorderSavingsGoalQueue(ctx, { goal_ids: [G1, G3, G2] })
    expect(result.moved).toBe(2)
    expect(state.updates.map((u) => [u.filters[0]?.[1], u.row])).toEqual([
      [G3, { queue_position: 1 }],
      [G2, { queue_position: 2 }],
    ])
  })

  it('refuses duplicates and unknown goals', async () => {
    const { ctx } = fakeContext({ tables })
    expect((await failure(reorderSavingsGoalQueue(ctx, { goal_ids: [G1, G1] }))).code).toBe(
      'invalid_details',
    )
    expect((await failure(reorderSavingsGoalQueue(ctx, { goal_ids: [G1, 'unknown'] }))).code).toBe(
      'not_found',
    )
  })
})
