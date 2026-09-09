import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type WishlistItem = Tables<'wishlist_item'>

/** The wishlist-item fields a form supplies; identifiers and household are set by the hook. */
export interface WishlistItemInput {
  name: string
  amount_cents: number
  /** The member whose wish this is — a display tag, or null when it belongs to no one in particular. */
  member_id: string | null
  note: string | null
}

export interface UseWishlistResult {
  items: WishlistItem[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: WishlistItemInput) => Promise<void>
  update: (id: string, input: WishlistItemInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's wishlist items. RLS scopes reads to the household. */
export function useWishlist(): UseWishlistResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'wishlist_item',
    WishlistItemInput
  >({ table: 'wishlist_item', orderBy: 'name' })
  return { items: rows, loading, reload, create, update, remove }
}
