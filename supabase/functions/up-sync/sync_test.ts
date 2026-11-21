import { assertEquals } from '@std/assert'
import {
  accountName,
  type AccountReconcile,
  type AccountRow,
  backfillStart,
  buildAccountRows,
  type ConnectedMember,
  GIFT_WINDOW_DAYS,
  giftWindowStart,
  type JointAccountReconcile,
  ledgerSince,
  membersToSync,
  runSync,
  type StoredGiftQuery,
  SYNC_BATCH_SIZE,
  type SyncDeps,
  UP_GIFT_CATEGORY,
} from './sync.ts'
import type { TransactionUpsert } from './map.ts'
import { UpApiError } from '../_shared/up.ts'
import type { UpAccount, UpTransaction } from '../_shared/up.ts'

function account(overrides: Partial<UpAccount['attributes']> = {}, id = 'acc-1'): UpAccount {
  return {
    id,
    attributes: {
      displayName: 'Spending',
      accountType: 'TRANSACTIONAL',
      ownershipType: 'INDIVIDUAL',
      balance: { currencyCode: 'AUD', value: '12.34', valueInBaseUnits: 1234 },
      createdAt: '2026-01-01T00:00:00+11:00',
      ...overrides,
    },
  }
}

const member: ConnectedMember = { memberId: 'm-1', householdId: 'h-1', name: 'Alex' }

Deno.test('buildAccountRows attributes an individual account to the member', () => {
  assertEquals(buildAccountRows([account()], member), [
    {
      external_id: 'acc-1',
      name: "Alex's Spending",
      type: 'transaction',
      balance_cents: 1234,
      currency: 'AUD',
      source: 'up',
      household_id: 'h-1',
      owner_member_id: 'm-1',
    },
  ])
})

Deno.test('buildAccountRows leaves a joint account unowned', () => {
  const [row] = buildAccountRows([account({ ownershipType: 'JOINT' })], member)
  assertEquals(row.owner_member_id, null)
  assertEquals(row.household_id, 'h-1')
})

Deno.test('accountName prefixes an individual spending account with the owner name', () => {
  assertEquals(accountName(account(), member, false), "Alex's Spending")
})

Deno.test('accountName is idempotent: recomputed from Up it never double-prefixes', () => {
  // Up always returns the raw "Spending"; recomputing each sync keeps the name
  // stable rather than compounding to "Alex's Alex's Spending".
  assertEquals(accountName(account(), member, false), "Alex's Spending")
  assertEquals(accountName(account(), member, false), "Alex's Spending")
})

Deno.test('accountName leaves a joint (shared) spending account unprefixed', () => {
  const joint = account({ ownershipType: 'JOINT', displayName: '2Up' })
  assertEquals(accountName(joint, member, true), '2Up')
})

Deno.test('accountName leaves a saver unprefixed', () => {
  const saver = account({ accountType: 'SAVER', displayName: '🏖 Holiday' })
  assertEquals(accountName(saver, member, false), '🏖 Holiday')
})

const otherMember: ConnectedMember = { memberId: 'm-2', householdId: 'h-2', name: 'Sam' }

Deno.test('membersToSync passes every member through for the cron path (null)', () => {
  assertEquals(membersToSync([member, otherMember], null), [member, otherMember])
})

Deno.test('membersToSync keeps only the caller household for a scoped call', () => {
  assertEquals(membersToSync([member, otherMember], 'h-1'), [member])
})

Deno.test('membersToSync is empty when the caller household has no connected members', () => {
  assertEquals(membersToSync([member, otherMember], 'h-3'), [])
})

/** An Up transaction on `accountId`, in the gift category unless told otherwise. */
function transaction(
  id = 'tx-1',
  accountId = 'acc-1',
  category: string | null = UP_GIFT_CATEGORY,
): UpTransaction {
  return {
    id,
    attributes: {
      status: 'SETTLED',
      description: 'Gift shop',
      message: null,
      isCategorizable: true,
      amount: { currencyCode: 'AUD', value: '-40.00', valueInBaseUnits: -40_00 },
      createdAt: '2026-06-01T08:00:00+10:00',
      settledAt: '2026-06-01T09:00:00+10:00',
      transactionType: 'Purchase',
      deepLinkURL: `up://transaction/${id}`,
      note: null,
      performingCustomer: null,
    },
    relationships: {
      account: { data: { id: accountId } },
      category: { data: category === null ? null : { id: category } },
      parentCategory: { data: null },
      transferAccount: { data: null },
    },
  }
}

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    listConnectedMembers: () => Promise.resolve([member]),
    tokenFor: () => Promise.resolve('tok'),
    listAccounts: () => Promise.resolve([account()]),
    upsertAccounts: () => Promise.resolve(),
    reconcileAccounts: () => Promise.resolve(),
    reconcileJointAccounts: () => Promise.resolve(),
    // Every Up account resolves to a local row named after it.
    listSyncedAccounts: (externalIds) =>
      Promise.resolve(externalIds.map((externalId) => ({
        external_id: externalId,
        id: `local-${externalId}`,
        household_id: 'h-1',
        owner_member_id: 'm-1',
      }))),
    latestPostedAt: () => Promise.resolve(null),
    listAccountTransactions: () => Promise.resolve([]),
    listGiftTransactions: () => Promise.resolve([]),
    listStoredGiftTransactionIds: () => Promise.resolve([]),
    getTransaction: () => Promise.resolve(null),
    syncTransactions: () => Promise.resolve([]),
    deleteTransactions: () => Promise.resolve(),
    listCategories: () => Promise.resolve([]),
    syncCategories: () => Promise.resolve(),
    disconnectMember: () => Promise.resolve(),
    listMembersWithWebhook: () => Promise.resolve(['m-1', 'm-2']),
    registerWebhook: () => Promise.resolve(),
    promptReview: () => Promise.resolve(),
    ...overrides,
  }
}

/** One `sync_up_transactions` call. */
interface SyncCall {
  householdId: string
  rows: TransactionUpsert[]
}

/** Records every `sync_up_transactions` call a run makes. */
function recordSyncs(calls: SyncCall[]): Partial<SyncDeps> {
  return {
    syncTransactions: (householdId, rows) => {
      calls.push({ householdId, rows })
      return Promise.resolve(rows.map((row) => ({ id: `id-${row.external_id}`, inserted: true })))
    },
  }
}

/** The Up ids a run landed, across every call, in order. */
function landedIds(calls: SyncCall[]): string[] {
  return calls.flatMap((call) => call.rows.map((row) => row.external_id))
}

/** Records every account reconcile a run runs. */
function recordReconciles(reconciles: AccountReconcile[]): Partial<SyncDeps> {
  return {
    reconcileAccounts: (reconcile) => {
      reconciles.push(reconcile)
      return Promise.resolve()
    },
  }
}

/** Records every joint-account reconcile a run runs. */
function recordJointReconciles(reconciles: JointAccountReconcile[]): Partial<SyncDeps> {
  return {
    reconcileJointAccounts: (reconcile) => {
      reconciles.push(reconcile)
      return Promise.resolve()
    },
  }
}

Deno.test("runSync upserts every connected member's accounts and counts them", async () => {
  const upserted: AccountRow[][] = []
  const result = await runSync(
    deps({
      listConnectedMembers: () => Promise.resolve([member, otherMember]),
      tokenFor: (id) => Promise.resolve(`tok-${id}`),
      listAccounts: (token) =>
        Promise.resolve([account({}, `${token}-a`), account({}, `${token}-b`)]),
      upsertAccounts: (rows) => {
        upserted.push(rows)
        return Promise.resolve()
      },
    }),
  )

  assertEquals(result, { members: 2, accounts: 4, transactions: 0 })
  assertEquals(upserted.length, 2)
  assertEquals(upserted[0].map((r) => r.external_id), ['tok-m-1-a', 'tok-m-1-b'])
})

Deno.test('runSync dedups a joint account seen through both partners', async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const joint = account({ ownershipType: 'JOINT', displayName: '2Up' }, 'joint-1')
  const upserted: AccountRow[][] = []
  const result = await runSync(
    deps({
      listConnectedMembers: () => Promise.resolve([member, sam]),
      tokenFor: (id) => Promise.resolve(`tok-${id}`),
      // Both partners' tokens surface the same joint account plus their own.
      listAccounts: (token) => Promise.resolve([joint, account({}, `${token}-own`)]),
      upsertAccounts: (rows) => {
        upserted.push(rows)
        return Promise.resolve()
      },
    }),
  )

  const jointRows = upserted.flat().filter((r) => r.external_id === 'joint-1')
  assertEquals(jointRows.length, 1)
  assertEquals(jointRows[0].owner_member_id, null)
  // joint (once) + each partner's individual account.
  assertEquals(result, { members: 2, accounts: 3, transactions: 0 })
})

Deno.test('runSync scoped to a household syncs only that household', async () => {
  const upserted: AccountRow[][] = []
  const result = await runSync(
    deps({
      listConnectedMembers: () => Promise.resolve([member, otherMember]),
      tokenFor: (id) => Promise.resolve(`tok-${id}`),
      listAccounts: (token) => Promise.resolve([account({}, `${token}-a`)]),
      upsertAccounts: (rows) => {
        upserted.push(rows)
        return Promise.resolve()
      },
    }),
    'h-1',
  )

  assertEquals(result, { members: 1, accounts: 1, transactions: 0 })
  assertEquals(upserted.length, 1)
  assertEquals(upserted[0].map((r) => r.external_id), ['tok-m-1-a'])
})

Deno.test('runSync skips a member whose token is unreadable', async () => {
  let upserts = 0
  const result = await runSync(
    deps({
      tokenFor: () => Promise.resolve(null),
      upsertAccounts: () => {
        upserts++
        return Promise.resolve()
      },
    }),
  )

  assertEquals(result, { members: 1, accounts: 0, transactions: 0 })
  assertEquals(upserts, 0)
})

Deno.test("runSync keeps going when one member's account listing fails", async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const reconciles: AccountReconcile[] = []
  const result = await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    listAccounts: (token) =>
      token === 'tok-m-1'
        ? Promise.reject(new Error('Up API 401'))
        : Promise.resolve([account({}, `${token}-own`)]),
    ...recordReconciles(reconciles),
  }))

  // Alex's accounts, reconcile, and gift window are all lost; Sam's stand.
  assertEquals(result, { members: 2, accounts: 1, transactions: 0 })
  assertEquals(reconciles, [
    { memberId: 'm-2', householdId: 'h-1', presentExternalIds: ['tok-m-2-own'] },
  ])
})

Deno.test('runSync disconnects a member whose token is rejected with 401', async () => {
  const disconnected: string[] = []
  await runSync(deps({
    listAccounts: () => Promise.reject(new UpApiError(401, '/accounts', 'unauthorized')),
    disconnectMember: (memberId) => {
      disconnected.push(memberId)
      return Promise.resolve()
    },
  }))

  assertEquals(disconnected, ['m-1'])
})

Deno.test('runSync disconnects a member whose token is rejected with 403', async () => {
  const disconnected: string[] = []
  await runSync(deps({
    listAccounts: () => Promise.reject(new UpApiError(403, '/accounts', 'forbidden')),
    disconnectMember: (memberId) => {
      disconnected.push(memberId)
      return Promise.resolve()
    },
  }))

  assertEquals(disconnected, ['m-1'])
})

Deno.test('runSync does not disconnect a member on a transient (5xx) failure', async () => {
  const disconnected: string[] = []
  await runSync(deps({
    listAccounts: () => Promise.reject(new UpApiError(503, '/accounts', 'unavailable')),
    disconnectMember: (memberId) => {
      disconnected.push(memberId)
      return Promise.resolve()
    },
  }))

  assertEquals(disconnected, [])
})

Deno.test('runSync does not disconnect a member on a plain (non-Up-API) error', async () => {
  const disconnected: string[] = []
  await runSync(deps({
    listAccounts: () => Promise.reject(new Error('network down')),
    disconnectMember: (memberId) => {
      disconnected.push(memberId)
      return Promise.resolve()
    },
  }))

  assertEquals(disconnected, [])
})

Deno.test("runSync keeps going when a member's disconnectMember call itself fails", async () => {
  const result = await runSync(deps({
    listAccounts: () => Promise.reject(new UpApiError(401, '/accounts', 'unauthorized')),
    disconnectMember: () => Promise.reject(new Error('rpc down')),
  }))

  assertEquals(result, { members: 1, accounts: 0, transactions: 0 })
})

Deno.test('runSync does not upsert when a member has no accounts', async () => {
  let upserts = 0
  const result = await runSync(
    deps({
      listAccounts: () => Promise.resolve([]),
      upsertAccounts: () => {
        upserts++
        return Promise.resolve()
      },
    }),
  )

  assertEquals(result, { members: 1, accounts: 0, transactions: 0 })
  assertEquals(upserts, 0)
})

Deno.test('giftWindowStart is a fixed span back from now, not a moving cursor', () => {
  assertEquals(GIFT_WINDOW_DAYS, 365)
  assertEquals(UP_GIFT_CATEGORY, 'gifts-and-charity')
  assertEquals(
    giftWindowStart(new Date('2026-07-01T00:00:00Z')).toISOString(),
    '2025-07-01T00:00:00.000Z',
  )
})

Deno.test('backfillStart is midnight AEST on 1 July of the prior financial year', () => {
  // 20 Nov 2026 is in FY2027, so the prior year, FY2026, began 1 Jul 2025.
  assertEquals(
    backfillStart(new Date('2026-11-20T00:00:00Z')).toISOString(),
    '2025-06-30T14:00:00.000Z',
  )
  // 30 Jun 2026 is still FY2026, so the prior year began 1 Jul 2024.
  assertEquals(
    backfillStart(new Date('2026-06-30T00:00:00Z')).toISOString(),
    '2024-06-30T14:00:00.000Z',
  )
})

Deno.test('ledgerSince backfills an account with no rows, else overlaps a day', () => {
  const now = new Date('2026-11-20T00:00:00Z')
  assertEquals(ledgerSince(null, now).toISOString(), '2025-06-30T14:00:00.000Z')
  assertEquals(
    ledgerSince('2026-11-19T12:00:00+00:00', now).toISOString(),
    '2026-11-18T12:00:00.000Z',
  )
})

Deno.test('runSync lands each account from its own high-water mark', async () => {
  const calls: SyncCall[] = []
  const polled: { accountId: string; since: string }[] = []
  const result = await runSync(deps({
    listAccounts: () => Promise.resolve([account({}, 'acc-1'), account({}, 'acc-2')]),
    latestPostedAt: (accountId) =>
      Promise.resolve(accountId === 'local-acc-1' ? '2026-11-19T12:00:00Z' : null),
    listAccountTransactions: (_token, accountId, since) => {
      polled.push({ accountId, since: since.toISOString() })
      return Promise.resolve([transaction(`tx-${accountId}`, accountId, 'groceries')])
    },
    ...recordSyncs(calls),
  }))

  assertEquals(polled[0], { accountId: 'acc-1', since: '2026-11-18T12:00:00.000Z' })
  assertEquals(polled[1].accountId, 'acc-2')
  assertEquals(polled[1].since, backfillStart().toISOString())
  assertEquals(landedIds(calls), ['tx-acc-1', 'tx-acc-2'])
  assertEquals(calls.map((call) => call.householdId), ['h-1', 'h-1'])
  assertEquals(result.transactions, 2)
})

Deno.test('runSync lands a joint account once, through the first token that sees it', async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const joint = account({ ownershipType: 'JOINT', displayName: '2Up' }, 'joint-1')
  const polled: string[] = []
  await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    listAccounts: (token) => Promise.resolve([joint, account({}, `${token}-own`)]),
    listAccountTransactions: (token, accountId) => {
      polled.push(`${token}:${accountId}`)
      return Promise.resolve([])
    },
  }))

  assertEquals(polled, ['tok-m-1:joint-1', 'tok-m-1:tok-m-1-own', 'tok-m-2:tok-m-2-own'])
})

Deno.test('runSync lands a backfill in batches', async () => {
  const calls: SyncCall[] = []
  const many = Array.from({ length: SYNC_BATCH_SIZE + 1 }, (_, i) => transaction(`tx-${i}`))
  await runSync(deps({
    listAccountTransactions: () => Promise.resolve(many),
    ...recordSyncs(calls),
  }))

  assertEquals(calls.map((call) => call.rows.length), [SYNC_BATCH_SIZE, 1])
})

Deno.test('runSync lands an account oldest first, so a failed batch leaves a safe mark', async () => {
  const calls: SyncCall[] = []
  const newer = { ...transaction('tx-newer') }
  const older = {
    ...transaction('tx-older'),
    attributes: { ...transaction('tx-older').attributes, settledAt: '2026-05-01T09:00:00+10:00' },
  }
  await runSync(deps({
    // Up lists newest first.
    listAccountTransactions: () => Promise.resolve([newer, older]),
    ...recordSyncs(calls),
  }))

  assertEquals(landedIds(calls), ['tx-older', 'tx-newer'])
})

Deno.test('runSync skips a transaction on an account the pass did not sync', async () => {
  const calls: SyncCall[] = []
  const result = await runSync(deps({
    listSyncedAccounts: () =>
      Promise.resolve([{
        external_id: 'acc-1',
        id: 'local-acc-1',
        household_id: 'h-1',
        owner_member_id: 'm-1',
      }]),
    listAccountTransactions: () =>
      Promise.resolve([transaction('tx-1'), transaction('tx-2', 'acc-unsynced')]),
    ...recordSyncs(calls),
  }))

  assertEquals(landedIds(calls), ['tx-1'])
  assertEquals(result.transactions, 1)
})

Deno.test('runSync still rescans gifts when the ledger pass fails', async () => {
  const calls: SyncCall[] = []
  await runSync(deps({
    listAccountTransactions: () => Promise.reject(new Error('Up API 500')),
    listGiftTransactions: () => Promise.resolve([transaction('tx-gift')]),
    ...recordSyncs(calls),
  }))

  assertEquals(landedIds(calls), ['tx-gift'])
})

Deno.test('runSync rescans the gift category from the trailing window start', async () => {
  let polledSince: Date | undefined
  let query: StoredGiftQuery | undefined
  await runSync(deps({
    listGiftTransactions: (_token, since) => {
      polledSince = since
      return Promise.resolve([])
    },
    listStoredGiftTransactionIds: (q) => {
      query = q
      return Promise.resolve([])
    },
  }))

  // Both the Up filter and the stored rows' floor are the one window start.
  assertEquals(polledSince?.toISOString(), query?.since)
  assertEquals(query?.accountIds, ['local-acc-1'])
  const drift = Math.abs(polledSince!.getTime() - giftWindowStart().getTime())
  assertEquals(drift < 1000, true)
})

Deno.test('runSync refreshes a stored gift row Up recategorised away, in place', async () => {
  const calls: SyncCall[] = []
  const fetched: string[] = []
  let deleted: string[] | undefined
  await runSync(deps({
    listGiftTransactions: () => Promise.resolve([transaction('tx-still-gift')]),
    listStoredGiftTransactionIds: () => Promise.resolve(['tx-still-gift', 'tx-moved']),
    getTransaction: (_token, id) => {
      fetched.push(id)
      return Promise.resolve(transaction(id, 'acc-1', 'clothing-and-accessories'))
    },
    deleteTransactions: (_householdId, ids) => {
      deleted = ids
      return Promise.resolve()
    },
    ...recordSyncs(calls),
  }))

  // Only the row Up stopped listing is re-read, and it lands with its new
  // category rather than being deleted.
  assertEquals(fetched, ['tx-moved'])
  const moved = calls.flatMap((call) => call.rows).find((row) => row.external_id === 'tx-moved')
  assertEquals(moved?.external_category, 'clothing-and-accessories')
  assertEquals(deleted, undefined)
})

Deno.test('runSync deletes a stored gift row Up no longer has', async () => {
  const deletions: { householdId: string; ids: string[] }[] = []
  await runSync(deps({
    listStoredGiftTransactionIds: () => Promise.resolve(['tx-dropped']),
    getTransaction: () => Promise.resolve(null),
    deleteTransactions: (householdId, ids) => {
      deletions.push({ householdId, ids })
      return Promise.resolve()
    },
  }))

  assertEquals(deletions, [{ householdId: 'h-1', ids: ['tx-dropped'] }])
})

Deno.test('runSync lands a transaction once when both passes return it', async () => {
  const calls: SyncCall[] = []
  await runSync(deps({
    listAccountTransactions: () => Promise.resolve([transaction('tx-1')]),
    listGiftTransactions: () => Promise.resolve([transaction('tx-1')]),
    ...recordSyncs(calls),
  }))

  // Once per pass; within a single call each Up id appears only once.
  for (const call of calls) {
    assertEquals(new Set(call.rows.map((row) => row.external_id)).size, call.rows.length)
  }
})

Deno.test('runSync syncs no transactions for a member whose token is unreadable', async () => {
  const calls: SyncCall[] = []
  await runSync(deps({ tokenFor: () => Promise.resolve(null), ...recordSyncs(calls) }))
  assertEquals(calls.length, 0)
})

Deno.test("runSync keeps going when one member's transaction passes fail", async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const calls: SyncCall[] = []
  const result = await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    listAccounts: (token) => Promise.resolve([account({}, `${token}-own`)]),
    listAccountTransactions: (token, accountId) =>
      token === 'tok-m-1'
        ? Promise.reject(new UpApiError(429, '/accounts', ''))
        : Promise.resolve([transaction('tx-1', accountId)]),
    listGiftTransactions: (token) =>
      token === 'tok-m-1' ? Promise.reject(new Error('Up API 429')) : Promise.resolve([]),
    ...recordSyncs(calls),
  }))

  // Alex's transactions are lost; Sam's land and both members' balances stand.
  assertEquals(result, { members: 2, accounts: 2, transactions: 1 })
  assertEquals(landedIds(calls), ['tx-1'])
})

Deno.test('runSync reconciles each synced member against the ids their token returned', async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const joint = account({ ownershipType: 'JOINT', displayName: '2Up' }, 'joint-1')
  const reconciles: AccountReconcile[] = []
  await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    listAccounts: (token) => Promise.resolve([joint, account({}, `${token}-own`)]),
    ...recordReconciles(reconciles),
  }))

  // One reconcile per member, each carrying that member's own household and the
  // full id set their token returned — the joint id included, though the RPC
  // scopes itself to individually-owned rows.
  assertEquals(reconciles, [
    { memberId: 'm-1', householdId: 'h-1', presentExternalIds: ['joint-1', 'tok-m-1-own'] },
    { memberId: 'm-2', householdId: 'h-1', presentExternalIds: ['joint-1', 'tok-m-2-own'] },
  ])
})

Deno.test('runSync reconciles a member with no Up accounts against an empty set', async () => {
  const reconciles: AccountReconcile[] = []
  await runSync(deps({
    listAccounts: () => Promise.resolve([]),
    ...recordReconciles(reconciles),
  }))

  assertEquals(reconciles, [
    { memberId: 'm-1', householdId: 'h-1', presentExternalIds: [] },
  ])
})

Deno.test('runSync does not reconcile a member whose token is unreadable', async () => {
  const reconciles: AccountReconcile[] = []
  await runSync(deps({ tokenFor: () => Promise.resolve(null), ...recordReconciles(reconciles) }))
  assertEquals(reconciles.length, 0)
})

Deno.test("runSync keeps going when one member's reconcile fails", async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const calls: SyncCall[] = []
  const result = await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    listAccounts: (token) => Promise.resolve([account({}, `${token}-own`)]),
    reconcileAccounts: (reconcile) =>
      reconcile.memberId === 'm-1'
        ? Promise.reject(new Error('reconcile RPC 500'))
        : Promise.resolve(),
    listAccountTransactions: (_token, accountId) =>
      Promise.resolve([transaction(`tx-${accountId}`, accountId)]),
    ...recordSyncs(calls),
  }))

  // Both members' balances and transactions still land.
  assertEquals(result, { members: 2, accounts: 2, transactions: 2 })
  assertEquals(landedIds(calls), ['tx-tok-m-1-own', 'tx-tok-m-2-own'])
})

Deno.test("runSync reconciles a household's joint accounts against the union of its members' ids", async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const joint = account({ ownershipType: 'JOINT', displayName: '2Up' }, 'joint-1')
  const jointReconciles: JointAccountReconcile[] = []
  await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    // Only Alex's token still reports the joint account; Sam's has dropped it.
    listAccounts: (token) =>
      token === 'tok-m-1'
        ? Promise.resolve([joint, account({}, 'tok-m-1-own')])
        : Promise.resolve([account({}, 'tok-m-2-own')]),
    ...recordJointReconciles(jointReconciles),
  }))

  // One call for the household, carrying the union of both tokens' ids: the
  // joint id survives because one member still reports it.
  assertEquals(jointReconciles, [
    { householdId: 'h-1', presentExternalIds: ['joint-1', 'tok-m-1-own', 'tok-m-2-own'] },
  ])
})

Deno.test('runSync passes a joint account absent from every member to the joint reconcile', async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const jointReconciles: JointAccountReconcile[] = []
  await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    listAccounts: (token) => Promise.resolve([account({}, `${token}-own`)]),
    ...recordJointReconciles(jointReconciles),
  }))

  // Neither token reports 'joint-1', so it is absent from the union the RPC
  // reconciles against, and the RPC deletes or flags it.
  assertEquals(jointReconciles, [
    { householdId: 'h-1', presentExternalIds: ['tok-m-1-own', 'tok-m-2-own'] },
  ])
})

Deno.test('runSync reconciles the joint accounts of a household with a single connected member', async () => {
  const jointReconciles: JointAccountReconcile[] = []
  await runSync(deps({ ...recordJointReconciles(jointReconciles) }))

  // Nothing but this member can see the joint account, so their set is the
  // whole union.
  assertEquals(jointReconciles, [
    { householdId: 'h-1', presentExternalIds: ['acc-1'] },
  ])
})

Deno.test('runSync skips the joint reconcile for a household with an unreadable-token member', async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const jointReconciles: JointAccountReconcile[] = []
  await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(id === 'm-2' ? null : 'tok-m-1'),
    listAccounts: () => Promise.resolve([account({}, 'a-1')]),
    ...recordJointReconciles(jointReconciles),
  }))

  // Sam's token is unreadable, so an absent joint account could just be hidden
  // by the missing read — the household is left until a run that covers it.
  assertEquals(jointReconciles, [])
})

Deno.test('runSync reconciles a fully-synced household and skips one with a gap in the same run', async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const jo: ConnectedMember = { memberId: 'm-3', householdId: 'h-2', name: 'Jo' }
  const kit: ConnectedMember = { memberId: 'm-4', householdId: 'h-2', name: 'Kit' }
  const jointReconciles: JointAccountReconcile[] = []
  await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam, jo, kit]),
    // h-1 syncs fully; h-2's second member (Kit) has an unreadable token.
    tokenFor: (id) => Promise.resolve(id === 'm-4' ? null : `tok-${id}`),
    listAccounts: (token) => Promise.resolve([account({}, `${token}-own`)]),
    ...recordJointReconciles(jointReconciles),
  }))

  assertEquals(jointReconciles, [
    { householdId: 'h-1', presentExternalIds: ['tok-m-1-own', 'tok-m-2-own'] },
  ])
})

Deno.test('runSync keeps going when a joint reconcile fails', async () => {
  const jo: ConnectedMember = { memberId: 'm-3', householdId: 'h-2', name: 'Jo' }
  const jointReconciles: JointAccountReconcile[] = []
  const result = await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, jo]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    listAccounts: (token) => Promise.resolve([account({}, `${token}-own`)]),
    reconcileJointAccounts: (reconcile) => {
      if (reconcile.householdId === 'h-1') {
        return Promise.reject(new Error('joint reconcile RPC 500'))
      }
      jointReconciles.push(reconcile)
      return Promise.resolve()
    },
  }))

  // h-1's joint reconcile is lost; h-2's still runs and the run still returns.
  assertEquals(result, { members: 2, accounts: 2, transactions: 0 })
  assertEquals(jointReconciles, [
    { householdId: 'h-2', presentExternalIds: ['tok-m-3-own'] },
  ])
})

Deno.test('runSync refreshes the category taxonomy once per run', async () => {
  const synced: unknown[] = []
  let listed = 0
  await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, { ...member, memberId: 'm-2' }]),
    listCategories: () => {
      listed++
      return Promise.resolve([
        {
          id: 'personal',
          attributes: { name: 'Personal' },
          relationships: { parent: { data: null } },
        },
        {
          id: 'gifts-and-charity',
          attributes: { name: 'Gifts & Charity' },
          relationships: { parent: { data: { id: 'personal' } } },
        },
      ])
    },
    syncCategories: (rows) => {
      synced.push(rows)
      return Promise.resolve()
    },
  }))
  assertEquals(listed, 1)
  assertEquals(synced, [[
    { id: 'personal', name: 'Personal', parent_id: null },
    { id: 'gifts-and-charity', name: 'Gifts & Charity', parent_id: 'personal' },
  ]])
})

Deno.test('runSync retries a failed category refresh with the next member and still syncs', async () => {
  const original = console.error
  console.error = () => {}
  let attempts = 0
  let refreshed = 0
  try {
    const result = await runSync(deps({
      listConnectedMembers: () => Promise.resolve([member, { ...member, memberId: 'm-2' }]),
      listCategories: () => {
        attempts++
        return attempts === 1 ? Promise.reject(new Error('Up down')) : Promise.resolve([])
      },
      syncCategories: () => {
        refreshed++
        return Promise.resolve()
      },
    }))
    assertEquals(result.members, 2)
  } finally {
    console.error = original
  }
  assertEquals(attempts, 2)
  assertEquals(refreshed, 1)
})

Deno.test('runSync registers a webhook only for a member lacking one', async () => {
  const registered: [string, string][] = []
  await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, otherMember]),
    tokenFor: (memberId) => Promise.resolve(`tok-${memberId}`),
    listMembersWithWebhook: () => Promise.resolve([member.memberId]),
    registerWebhook: (memberId, token) => {
      registered.push([memberId, token])
      return Promise.resolve()
    },
  }))

  assertEquals(registered, [[otherMember.memberId, `tok-${otherMember.memberId}`]])
})

Deno.test('runSync never registers a webhook through a token Up rejects', async () => {
  let registered = false
  await runSync(deps({
    listAccounts: () => Promise.reject(new UpApiError(401, '/accounts', 'unauthorized')),
    listMembersWithWebhook: () => Promise.resolve([]),
    registerWebhook: () => {
      registered = true
      return Promise.resolve()
    },
  }))
  assertEquals(registered, false)
})

Deno.test('runSync carries on when webhook registration fails', async () => {
  const calls: SyncCall[] = []
  const result = await runSync(deps({
    ...recordSyncs(calls),
    listMembersWithWebhook: () => Promise.resolve([]),
    registerWebhook: () => Promise.reject(new Error('Up down')),
    listAccountTransactions: () => Promise.resolve([transaction('tx-1', 'acc-1', null)]),
  }))
  assertEquals(result.transactions, 1)
})

Deno.test('runSync registers nothing when it cannot tell who has a webhook', async () => {
  let registered = false
  const result = await runSync(deps({
    listMembersWithWebhook: () => Promise.reject(new Error('db down')),
    registerWebhook: () => {
      registered = true
      return Promise.resolve()
    },
  }))
  assertEquals(registered, false)
  assertEquals(result.members, 1)
})

Deno.test('runSync prompts review of only the rows it newly inserted, per household', async () => {
  const prompted: Array<{ householdId: string; ids: string[] }> = []
  await runSync(deps({
    listAccountTransactions: () =>
      Promise.resolve([transaction('tx-new', 'acc-1', null), transaction('tx-old', 'acc-1', null)]),
    syncTransactions: (_householdId, rows) =>
      Promise.resolve(
        rows.map((row) => ({
          id: `id-${row.external_id}`,
          inserted: row.external_id === 'tx-new',
        })),
      ),
    promptReview: (householdId, ids) => {
      prompted.push({ householdId, ids })
      return Promise.resolve()
    },
  }))
  assertEquals(prompted, [{ householdId: 'h-1', ids: ['id-tx-new'] }])
})
