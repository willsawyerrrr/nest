import { describe, expect, it } from 'vitest'
import { failure } from '../test/failure.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import { deleteWishlistItem, updateWishlistItem } from './wishlist.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'
const item = {
  id: ID,
  household_id: 'h-1',
  name: 'Bike',
  amount_cents: 900_00,
  member_id: 'm-self',
  note: 'blue',
}

describe('updateWishlistItem', () => {
  it('changes only the fields given', async () => {
    const { ctx, state } = fakeContext({ tables: { wishlist_item: [item], members } })
    await updateWishlistItem(ctx, { id: ID, amount_cents: 950_00 })
    expect(state.updates[0]?.row).toEqual({
      name: 'Bike',
      amount_cents: 950_00,
      member_id: 'm-self',
      note: 'blue',
    })
  })

  it('retags to another member and clears the note', async () => {
    const { ctx, state } = fakeContext({ tables: { wishlist_item: [item], members } })
    const result = await updateWishlistItem(ctx, { id: ID, member: 'Sam', note: null })
    expect(state.updates[0]?.row).toMatchObject({ member_id: 'm-other', note: null })
    expect(result.member_id).toBe('m-other')
  })

  it('clears the member tag with null', async () => {
    const { ctx, state } = fakeContext({ tables: { wishlist_item: [item], members } })
    await updateWishlistItem(ctx, { id: ID, member: null })
    expect(state.updates[0]?.row).toMatchObject({ member_id: null })
  })

  it('refuses unknown items and members, and reports failed saves', async () => {
    const none = fakeContext()
    expect((await failure(updateWishlistItem(none.ctx, { id: ID, name: 'X' }))).code).toBe(
      'not_found',
    )
    const { ctx } = fakeContext({ tables: { wishlist_item: [item], members } })
    expect((await failure(updateWishlistItem(ctx, { id: ID, member: 'Nobody' }))).code).toBe(
      'not_found',
    )
    const failing = fakeContext({ tables: { wishlist_item: [item], members }, updateError: true })
    expect((await failure(updateWishlistItem(failing.ctx, { id: ID, name: 'X' }))).code).toBe(
      'save_failed',
    )
  })
})

describe('deleteWishlistItem', () => {
  it('deletes an item and refuses an unknown one', async () => {
    const { ctx, state } = fakeContext({ tables: { wishlist_item: [item] } })
    await expect(deleteWishlistItem(ctx, { id: ID })).resolves.toEqual({ id: ID })
    expect(state.deletes[0]?.table).toBe('wishlist_item')
    const none = fakeContext()
    expect((await failure(deleteWishlistItem(none.ctx, { id: ID }))).code).toBe('not_found')
  })
})
