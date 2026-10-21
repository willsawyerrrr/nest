import { describe, expect, it } from 'vitest'
import { failure } from '../test/failure.ts'
import { fakeContext } from '../test/fakeContext.ts'
import {
  addBreakdown,
  addBreakdownItem,
  deleteBreakdown,
  deleteBreakdownItem,
  listBreakdowns,
  updateBreakdown,
  updateBreakdownItem,
} from './breakdowns.ts'

const B = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'
const I = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const breakdown = { id: B, household_id: 'h-1', name: 'Meds', line_group: 'needs' }
const item = {
  id: I,
  household_id: 'h-1',
  breakdown_id: B,
  name: 'Pill',
  amount_cents: 10_00,
  frequency: 'weekly',
  interval_count: null,
}

describe('listBreakdowns', () => {
  it('rolls items up into fortnightly and annual totals', async () => {
    const { ctx } = fakeContext({
      tables: {
        breakdown: [breakdown],
        breakdown_item: [item, { ...item, id: 'i-2', name: 'Cream', frequency: 'fortnightly' }],
        budget_line: [{ id: 'l-1', breakdown_id: B }],
      },
    })
    const { breakdowns } = await listBreakdowns(ctx)
    expect(breakdowns).toHaveLength(1)
    expect(breakdowns[0]).toMatchObject({
      name: 'Meds',
      group: 'needs',
      budget_line_id: 'l-1',
      fortnightly_cents: 30_00,
    })
    expect(breakdowns[0]?.items.map((i) => i.name)).toEqual(['Cream', 'Pill'])
  })
})

describe('breakdowns', () => {
  it('creates a generic breakdown', async () => {
    const { ctx, state } = fakeContext()
    await expect(addBreakdown(ctx, { name: 'Meds', group: 'needs' })).resolves.toEqual({
      id: 'new-id',
      name: 'Meds',
      group: 'needs',
    })
    expect(state.inserts[0]).toEqual({
      table: 'breakdown',
      row: { household_id: 'h-1', name: 'Meds', line_group: 'needs', kind: 'generic' },
    })
  })

  it('reports a failed create with fixed copy', async () => {
    const { ctx } = fakeContext({ insertError: true })
    const error = await failure(addBreakdown(ctx, { name: 'Meds', group: 'needs' }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })

  it('updates only the fields given', async () => {
    const { ctx, state } = fakeContext({ tables: { breakdown: [breakdown] } })
    await updateBreakdown(ctx, { id: B, group: 'wants' })
    expect(state.updates[0]?.row).toEqual({ name: 'Meds', line_group: 'wants' })
  })

  it('refuses an unknown breakdown', async () => {
    const { ctx } = fakeContext()
    expect((await failure(updateBreakdown(ctx, { id: B, name: 'X' }))).code).toBe('not_found')
    expect((await failure(deleteBreakdown(ctx, { id: B }))).code).toBe('not_found')
  })

  it('deletes a breakdown', async () => {
    const { ctx, state } = fakeContext({ tables: { breakdown: [breakdown] } })
    await expect(deleteBreakdown(ctx, { id: B })).resolves.toEqual({ id: B })
    expect(state.deletes[0]?.table).toBe('breakdown')
  })
})

describe('breakdown items', () => {
  it('adds an item to an existing breakdown', async () => {
    const { ctx, state } = fakeContext({ tables: { breakdown: [breakdown] } })
    await addBreakdownItem(ctx, {
      breakdown_id: B,
      name: 'Pill',
      amount_cents: 10_00,
      frequency: 'every_n_weeks',
      interval_count: 3,
    })
    expect(state.inserts[0]?.row).toMatchObject({
      breakdown_id: B,
      frequency: 'every_n_weeks',
      interval_count: 3,
    })
  })

  it('validates the interval and the parent', async () => {
    const { ctx } = fakeContext({ tables: { breakdown: [breakdown] } })
    const base = { breakdown_id: B, name: 'Pill', amount_cents: 1 } as const
    expect(
      (await failure(addBreakdownItem(ctx, { ...base, frequency: 'every_n_months' }))).code,
    ).toBe('invalid_details')
    const empty = fakeContext()
    expect(
      (await failure(addBreakdownItem(empty.ctx, { ...base, frequency: 'weekly' }))).code,
    ).toBe('not_found')
  })

  it('updates, keeping the interval unless the cadence changes', async () => {
    const { ctx, state } = fakeContext({
      tables: { breakdown_item: [{ ...item, frequency: 'every_n_weeks', interval_count: 2 }] },
    })
    await updateBreakdownItem(ctx, { id: I, amount_cents: 5_00 })
    expect(state.updates[0]?.row).toMatchObject({ amount_cents: 5_00, interval_count: 2 })
    await updateBreakdownItem(ctx, { id: I, frequency: 'monthly' })
    expect(state.updates[1]?.row).toMatchObject({ frequency: 'monthly', interval_count: null })
  })

  it('refuses an unknown item and failed saves', async () => {
    const none = fakeContext()
    expect((await failure(updateBreakdownItem(none.ctx, { id: I, name: 'X' }))).code).toBe(
      'not_found',
    )
    const failing = fakeContext({ tables: { breakdown_item: [item] }, updateError: true })
    expect((await failure(updateBreakdownItem(failing.ctx, { id: I, name: 'X' }))).code).toBe(
      'save_failed',
    )
  })

  it('deletes an item', async () => {
    const { ctx, state } = fakeContext({ tables: { breakdown_item: [item] } })
    await expect(deleteBreakdownItem(ctx, { id: I })).resolves.toEqual({ id: I })
    expect(state.deletes[0]?.table).toBe('breakdown_item')
  })
})
