import { describe, expect, it } from 'vitest'
import type { Tables } from './database.types'
import { memberName } from './members'
import { formatCents } from './money'
import { sortBy } from './sort'

/**
 * The wishlist the native Wishlist screen is held to. The rows are written in full,
 * as PostgREST returns them; the figures are what `WishlistScreen` shows for each
 * sort choice: the order (`sortBy` over its comparator), each item's owner pill
 * (`memberName`) and amount (`formatCents`). The fixture is committed beside the iOS
 * tests (`vitest -u` rewrites it); `WishlistParityTests` decodes the same rows and
 * must produce identical rows for every sort.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/wishlist-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string): Tables<'members'> => ({
  ...base,
  id,
  name,
  user_id: `u-${id}`,
  email: null,
  date_of_birth: null,
  up_connected_at: null,
  up_sync_failed_at: null,
})

const item = (
  id: string,
  name: string,
  amount_cents: number,
  member_id: string | null,
  note: string | null,
): Tables<'wishlist_item'> => ({ ...base, id, name, amount_cents, member_id, note })

const members = [member('m1', 'Alex'), member('m2', 'Sam')]
const items = [
  item('w1', 'espresso machine', 1_200_00, 'm1', 'The good one'),
  item('w2', 'Bike', 2_499_99, null, null),
  item('w3', 'Couch', 3_500_00, 'm2', null),
  item('w4', 'Ärmchair', 899_50, 'gone', 'Second-hand'),
  item('w5', 'Lamp', 1_200_00, null, null),
]

type SortKey = 'title' | 'amount'
const comparator = (key: SortKey) => (a: Tables<'wishlist_item'>, b: Tables<'wishlist_item'>) =>
  key === 'title' ? a.name.localeCompare(b.name) : a.amount_cents - b.amount_cents

const view = (key: SortKey, direction: 'asc' | 'desc') =>
  sortBy(items, comparator(key), direction).map((row) => ({
    id: row.id,
    name: row.name,
    ownerName: row.member_id ? memberName(members, row.member_id) : null,
    note: row.note,
    amount: formatCents(row.amount_cents),
  }))

const expected = {
  titleAsc: view('title', 'asc'),
  titleDesc: view('title', 'desc'),
  amountAsc: view('amount', 'asc'),
  amountDesc: view('amount', 'desc'),
}

describe('wishlist parity fixture', () => {
  it('matches the committed rows and figures', async () => {
    await expect(
      JSON.stringify({ rows: { items, members }, expected }, null, 2) + '\n',
    ).toMatchFileSnapshot(FIXTURE)
  })

  it('orders by title ignoring case, then by amount keeping ties in stored order', () => {
    expect(expected.titleAsc.map((row) => row.id)).toEqual(['w4', 'w2', 'w3', 'w1', 'w5'])
    expect(expected.amountAsc.map((row) => row.id)).toEqual(['w4', 'w1', 'w5', 'w2', 'w3'])
  })
})
