import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWishlistItem } from '../test/fixtures'
import { makeWrapper } from '../test/queryWrapper'
import { useWishlist, type WishlistItemInput } from './useWishlist'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'insert', 'update', 'delete', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

const input: WishlistItemInput = {
  name: 'New couch',
  amount_cents: 3_500_00,
  member_id: 'm1',
  note: 'The sectional one',
}

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = { data: [makeWishlistItem()], error: null }
})

describe('useWishlist', () => {
  it('exposes the household wishlist items and its mutations', async () => {
    const { result } = renderHook(() => useWishlist(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.items).toEqual([makeWishlistItem()]))
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await result.current.create(input)
      await result.current.update('w1', input)
      await result.current.remove('w1')
      await result.current.reload()
    })

    expect(builder.insert).toHaveBeenCalledWith({ ...input, household_id: 'h1' })
    expect(builder.update).toHaveBeenCalledWith(input)
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'w1')
    expect(builder.order).toHaveBeenCalledWith('name', { ascending: true })
  })
})
