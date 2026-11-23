import { assertEquals } from '@std/assert'
import type { DeliveryDeps } from './notify.ts'
import {
  isReviewable,
  notifyInsertedTransactions,
  resolvePurchaser,
  type ReviewContext,
  reviewFirings,
  reviewPayload,
  type ReviewTransactionRow,
} from './transactionReview.ts'

const NOW = new Date('2026-11-21T09:00:00Z')

const MEMBERS = [{ id: 'm-will', name: 'Will' }, { id: 'm-bronte', name: 'Bronte Hobday' }]
const HANDLES = [
  { member_id: 'm-will', handle: '$willsawyerrrr' },
  { member_id: 'm-bronte', handle: '$brontehobday' },
]

function tx(overrides: Partial<ReviewTransactionRow> = {}): ReviewTransactionRow {
  return {
    id: 'tx-1',
    account_id: 'joint',
    description: 'Myer',
    amount_cents: -42_10,
    posted_at: '2026-11-21T08:00:00Z',
    created_at: '2026-11-21T08:01:00Z',
    is_categorizable: true,
    reviewed_at: null,
    external_category: 'clothing-and-accessories',
    performing_customer_name: '$willsawyerrrr',
    ...overrides,
  }
}

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    accounts: [{ id: 'joint', owner_member_id: null }, { id: 'own', owner_member_id: 'm-bronte' }],
    members: MEMBERS,
    handles: HANDLES,
    categories: [{ id: 'clothing-and-accessories', name: 'Clothing & Accessories' }],
    linkedTransactionIds: new Set(),
    ...overrides,
  }
}

Deno.test('resolvePurchaser matches the handle seen on one member’s own accounts', () => {
  assertEquals(resolvePurchaser('$brontehobday', MEMBERS, HANDLES), 'm-bronte')
  assertEquals(resolvePurchaser(' $WillSawyerrrr ', MEMBERS, HANDLES), 'm-will')
})

Deno.test('resolvePurchaser falls back to a whole or first name for a member with no handle', () => {
  assertEquals(resolvePurchaser('$bronte', MEMBERS, []), 'm-bronte')
  assertEquals(resolvePurchaser('Bronte Hobday', MEMBERS, []), 'm-bronte')
  assertEquals(resolvePurchaser('$will', MEMBERS, []), 'm-will')
})

Deno.test('resolvePurchaser names nobody without one confident match', () => {
  assertEquals(resolvePurchaser(null, MEMBERS, HANDLES), null)
  assertEquals(resolvePurchaser('$someone', MEMBERS, HANDLES), null)
  // A member whose handle is known and differs is not matched by name.
  assertEquals(resolvePurchaser('$will', MEMBERS, HANDLES), null)
  // A handle shared by two members, or a name two members share, is ambiguous.
  assertEquals(
    resolvePurchaser('$x', MEMBERS, [
      { member_id: 'm-will', handle: '$x' },
      { member_id: 'm-bronte', handle: '$x' },
    ]),
    null,
  )
  assertEquals(
    resolvePurchaser('$sam', [{ id: 'a', name: 'Sam' }, { id: 'b', name: 'Sam Lee' }], []),
    null,
  )
  // A prefix is not a match.
  assertEquals(resolvePurchaser('$willsawyerrrr', MEMBERS, []), null)
})

Deno.test('isReviewable takes a fresh, categorisable, unreviewed first sight, pending included', () => {
  assertEquals(isReviewable(tx(), NOW), true)
  assertEquals(isReviewable(tx({ is_categorizable: false }), NOW), false)
  assertEquals(isReviewable(tx({ is_categorizable: null }), NOW), false)
  assertEquals(isReviewable(tx({ reviewed_at: '2026-11-21T08:30:00Z' }), NOW), false)
  // Backfilled history: Up dated it long before the ledger first saw it.
  assertEquals(isReviewable(tx({ posted_at: '2026-11-15T08:00:00Z' }), NOW), false)
  // First seen too long ago for the backstop.
  assertEquals(
    isReviewable(
      tx({ posted_at: '2026-11-18T08:00:00Z', created_at: '2026-11-18T08:01:00Z' }),
      NOW,
    ),
    false,
  )
  // A hold that settled after it was first seen.
  assertEquals(isReviewable(tx({ posted_at: '2026-11-21T08:50:00Z' }), NOW), true)
})

Deno.test('reviewPayload names the merchant, amount, and Up category', () => {
  const categories = context().categories
  assertEquals(reviewPayload(tx(), categories), {
    title: 'Myer · $42.10',
    body: 'Clothing & Accessories — right category?',
    url: '/transactions/review?id=tx-1',
    native: { category: 'transaction_review', transactionId: 'tx-1' },
  })
  assertEquals(
    reviewPayload(
      tx({ description: ' ', amount_cents: 5_00, external_category: null }),
      categories,
    ),
    {
      title: 'A transaction · +$5.00',
      body: 'Uncategorised — pick a category?',
      url: '/transactions/review?id=tx-1',
      native: { category: 'transaction_review', transactionId: 'tx-1' },
    },
  )
})

Deno.test('reviewFirings goes to an individual account’s owner and a joint account’s purchaser', () => {
  const firings = reviewFirings(
    [tx(), tx({ id: 'tx-2', account_id: 'own', performing_customer_name: null })],
    context(),
    NOW,
  )
  assertEquals(firings.map((firing) => [firing.dedupeKey, firing.visibleToMemberId]), [
    ['tx-1', 'm-will'],
    ['tx-2', 'm-bronte'],
  ])
})

Deno.test('reviewFirings skips an unmatched joint purchaser, a linked gift, and an unknown account', () => {
  const firings = reviewFirings(
    [
      tx({ performing_customer_name: '$stranger' }),
      tx({ id: 'tx-linked' }),
      tx({ id: 'tx-gone', account_id: 'missing' }),
    ],
    context({ linkedTransactionIds: new Set(['tx-linked']) }),
    NOW,
  )
  assertEquals(firings, [])
})

Deno.test('notifyInsertedTransactions binds delivery only when there is a prompt to send', async () => {
  let bound = 0
  const sent: string[] = []
  const delivery = (): Promise<DeliveryDeps> => {
    bound += 1
    return Promise.resolve({
      loadSubscriptions: () =>
        Promise.resolve([{
          id: 'w-1',
          member_id: 'm-will',
          endpoint: 'e',
          p256dh: 'p',
          auth: 'a',
        }]),
      loadApnsDevices: () => Promise.resolve([]),
      loadPreferences: () =>
        Promise.resolve([{ member_id: 'm-will', trigger: 'transaction_review', enabled: true }]),
      loadRecentLog: () => Promise.resolve([]),
      sendPush: (_device, payload) => {
        sent.push(payload.url)
        return Promise.resolve({ delivered: true })
      },
      sendApns: () => Promise.resolve({ delivered: true }),
      prune: () => Promise.resolve(),
      pruneApns: () => Promise.resolve(),
      recordLog: () => Promise.resolve(),
    })
  }
  const deps = (rows: ReviewTransactionRow[]) => ({
    loadTransactions: () => Promise.resolve(rows),
    loadContext: () => Promise.resolve(context()),
    delivery,
  })

  assertEquals(await notifyInsertedTransactions(deps([tx()]), 'h-1', [], NOW), null)
  assertEquals(
    await notifyInsertedTransactions(deps([tx({ is_categorizable: false })]), 'h-1', ['tx-1'], NOW),
    null,
  )
  assertEquals(bound, 0)

  const summary = await notifyInsertedTransactions(deps([tx()]), 'h-1', ['tx-1'], NOW)
  assertEquals(bound, 1)
  assertEquals(sent, ['/transactions/review?id=tx-1'])
  assertEquals(summary?.notified, 1)
})
