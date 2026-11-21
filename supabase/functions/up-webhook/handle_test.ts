import { assertEquals } from '@std/assert'
import { UpApiError, type UpTransaction } from '../_shared/up.ts'
import type { TransactionUpsert } from '../up-sync/map.ts'
import { type DeliveryDeps, handleDelivery } from './handle.ts'
import { toHex } from './signature.ts'

const MEMBER = '11111111-1111-4111-8111-111111111111'
const SECRET = 'member-secret'

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
}

function event(eventType: string, transactionId: string | null = 'tx-1'): string {
  return JSON.stringify({
    data: {
      type: 'webhook-events',
      id: 'ev-1',
      attributes: { eventType, createdAt: '2026-11-20T00:00:00+10:00' },
      relationships: {
        webhook: { data: { type: 'webhooks', id: 'wh-1' } },
        ...(transactionId
          ? { transaction: { data: { type: 'transactions', id: transactionId } } }
          : {}),
      },
    },
  })
}

function transaction(accountId = 'up-acc'): UpTransaction {
  return {
    id: 'tx-1',
    attributes: {
      status: 'SETTLED',
      description: 'Cafe',
      message: null,
      isCategorizable: true,
      amount: { currencyCode: 'AUD', value: '-4.50', valueInBaseUnits: -4_50 },
      createdAt: '2026-11-20T08:00:00+10:00',
      settledAt: '2026-11-20T09:00:00+10:00',
      transactionType: 'Purchase',
      deepLinkURL: 'up://transaction/tx-1',
      note: null,
      performingCustomer: null,
    },
    relationships: {
      account: { data: { id: accountId } },
      category: { data: null },
      parentCategory: { data: null },
      transferAccount: { data: null },
    },
  }
}

/** Happy-path fakes recording every write, overridable per test. */
function fakes(overrides: Partial<DeliveryDeps> = {}) {
  const synced: TransactionUpsert[][] = []
  const deleted: string[][] = []
  const deps: DeliveryDeps = {
    secretFor: () => Promise.resolve(SECRET),
    householdFor: () => Promise.resolve('h-1'),
    tokenFor: () => Promise.resolve('up:tok'),
    getTransaction: () => Promise.resolve(transaction()),
    accountFor: (householdId, upAccountId) =>
      Promise.resolve(
        upAccountId === 'up-acc'
          ? { id: 'acc-1', external_id: 'up-acc', household_id: householdId, owner_member_id: null }
          : null,
      ),
    syncTransactions: (_householdId, rows) => {
      synced.push(rows)
      return Promise.resolve([{ id: 'row-1', inserted: true }])
    },
    deleteTransactions: (_householdId, ids) => {
      deleted.push(ids)
      return Promise.resolve()
    },
    ...overrides,
  }
  return { deps, synced, deleted }
}

async function deliver(body: string, deps: DeliveryDeps, memberId: string | null = MEMBER) {
  return handleDelivery({ memberId, signature: await sign(body), rawBody: body }, deps)
}

Deno.test('a bad signature is a 401 that reads nothing else', async () => {
  const { deps, synced } = fakes()
  const body = event('TRANSACTION_CREATED')
  const result = await handleDelivery(
    { memberId: MEMBER, signature: await sign(body, 'wrong'), rawBody: body },
    deps,
  )
  assertEquals(result, { status: 401, body: 'Unauthorized', insertedIds: [] })
  assertEquals(synced, [])
})

Deno.test('a missing signature, member, or secret is the same 401', async () => {
  const body = event('PING')
  const { deps } = fakes()
  assertEquals(
    (await handleDelivery({ memberId: MEMBER, signature: null, rawBody: body }, deps)).status,
    401,
  )
  assertEquals((await deliver(body, deps, null)).status, 401)
  assertEquals((await deliver(body, deps, 'not-a-uuid')).status, 401)
  const noSecret = fakes({ secretFor: () => Promise.resolve(null) })
  assertEquals(await deliver(body, noSecret.deps), {
    status: 401,
    body: 'Unauthorized',
    insertedIds: [],
  })
})

Deno.test('a failed secret read is a 500 so Up redelivers', async () => {
  const { deps } = fakes({ secretFor: () => Promise.reject(new Error('db down')) })
  assertEquals((await deliver(event('PING'), deps)).status, 500)
})

Deno.test('PING is a bare 200', async () => {
  const { deps, synced } = fakes()
  assertEquals(await deliver(event('PING', null), deps), {
    status: 200,
    body: 'OK',
    insertedIds: [],
  })
  assertEquals(synced, [])
})

for (const eventType of ['TRANSACTION_CREATED', 'TRANSACTION_SETTLED']) {
  Deno.test(`${eventType} upserts the re-read transaction and reports it inserted`, async () => {
    const { deps, synced } = fakes()
    const result = await deliver(event(eventType), deps)
    assertEquals(result, { status: 200, body: 'OK', insertedIds: ['row-1'] })
    assertEquals(synced.length, 1)
    assertEquals(synced[0][0].external_id, 'tx-1')
    assertEquals(synced[0][0].account_id, 'acc-1')
    assertEquals(synced[0][0].household_id, 'h-1')
    assertEquals(synced[0][0].status, 'settled')
  })
}

Deno.test('an updated row is not reported as inserted', async () => {
  const { deps } = fakes({
    syncTransactions: () => Promise.resolve([{ id: 'row-1', inserted: false }]),
  })
  assertEquals((await deliver(event('TRANSACTION_SETTLED'), deps)).insertedIds, [])
})

Deno.test('a transaction on an unsynced account is skipped', async () => {
  const { deps, synced } = fakes({ getTransaction: () => Promise.resolve(transaction('other')) })
  assertEquals((await deliver(event('TRANSACTION_CREATED'), deps)).status, 200)
  assertEquals(synced, [])
})

Deno.test('a transaction Up no longer has is acknowledged without a write', async () => {
  const { deps, synced } = fakes({ getTransaction: () => Promise.resolve(null) })
  assertEquals((await deliver(event('TRANSACTION_CREATED'), deps)).status, 200)
  assertEquals(synced, [])
})

Deno.test('TRANSACTION_DELETED deletes the row through the RPC', async () => {
  const { deps, deleted, synced } = fakes()
  assertEquals((await deliver(event('TRANSACTION_DELETED'), deps)).status, 200)
  assertEquals(deleted, [['tx-1']])
  assertEquals(synced, [])
})

Deno.test('an Up outage is a 500 so Up redelivers', async () => {
  const { deps } = fakes({
    getTransaction: () => Promise.reject(new UpApiError(503, '/transactions/tx-1', '')),
  })
  assertEquals((await deliver(event('TRANSACTION_CREATED'), deps)).status, 500)
})

Deno.test('a token Up rejects is acknowledged, since redelivery cannot help', async () => {
  const { deps } = fakes({
    getTransaction: () => Promise.reject(new UpApiError(401, '/transactions/tx-1', '')),
  })
  assertEquals((await deliver(event('TRANSACTION_CREATED'), deps)).status, 200)
})

Deno.test('a failed upsert is a 500', async () => {
  const { deps } = fakes({ syncTransactions: () => Promise.reject(new Error('db down')) })
  assertEquals((await deliver(event('TRANSACTION_SETTLED'), deps)).status, 500)
})

Deno.test('a signed body that is not JSON, or names no transaction, is a 400', async () => {
  const { deps } = fakes()
  assertEquals((await deliver('not json', deps)).status, 400)
  assertEquals((await deliver(event('TRANSACTION_CREATED', null), deps)).status, 400)
})

Deno.test('an unknown event type is acknowledged', async () => {
  const { deps } = fakes()
  assertEquals((await deliver(event('SOMETHING_NEW', null), deps)).body, 'Ignored')
})
