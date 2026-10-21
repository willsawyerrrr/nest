import { describe, expect, it } from 'vitest'
import { failure } from '../test/failure.ts'
import { fakeContext } from '../test/fakeContext.ts'
import {
  addTemporaryItem,
  deleteTemporaryItem,
  listTemporaryItems,
  updateTemporaryItem,
} from './temporaryItems.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'
const item = {
  id: ID,
  household_id: 'h-1',
  name: 'Rego',
  contribution_cents: 40_00,
  target_date: '2027-01-01',
}

describe('temporary items', () => {
  it('lists by target date', async () => {
    const { ctx } = fakeContext({
      tables: {
        temporary_item: [item, { ...item, id: 'i-2', name: 'Soon', target_date: '2026-11-01' }],
      },
    })
    const { items } = await listTemporaryItems(ctx)
    expect(items.map((i) => i.name)).toEqual(['Soon', 'Rego'])
  })

  it('adds an item', async () => {
    const { ctx, state } = fakeContext()
    await addTemporaryItem(ctx, {
      name: 'Rego',
      contribution_cents: 40_00,
      target_date: '2027-01-01',
    })
    expect(state.inserts[0]).toEqual({
      table: 'temporary_item',
      row: {
        household_id: 'h-1',
        name: 'Rego',
        contribution_cents: 40_00,
        target_date: '2027-01-01',
      },
    })
  })

  it('reports a failed add with fixed copy', async () => {
    const { ctx } = fakeContext({ insertError: true })
    const error = await failure(
      addTemporaryItem(ctx, { name: 'R', contribution_cents: 1, target_date: '2027-01-01' }),
    )
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })

  it('updates only the fields given', async () => {
    const { ctx, state } = fakeContext({ tables: { temporary_item: [item] } })
    await updateTemporaryItem(ctx, { id: ID, target_date: '2027-03-01' })
    expect(state.updates[0]?.row).toEqual({
      name: 'Rego',
      contribution_cents: 40_00,
      target_date: '2027-03-01',
    })
  })

  it('refuses an unknown item on update and delete', async () => {
    const { ctx } = fakeContext()
    expect((await failure(updateTemporaryItem(ctx, { id: ID, name: 'X' }))).code).toBe('not_found')
    expect((await failure(deleteTemporaryItem(ctx, { id: ID }))).code).toBe('not_found')
  })

  it('deletes an item', async () => {
    const { ctx, state } = fakeContext({ tables: { temporary_item: [item] } })
    await expect(deleteTemporaryItem(ctx, { id: ID })).resolves.toEqual({ id: ID })
    expect(state.deletes[0]?.table).toBe('temporary_item')
  })
})
