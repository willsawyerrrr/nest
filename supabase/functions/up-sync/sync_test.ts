import { assertEquals } from '@std/assert'
import {
  accountName,
  type AccountReconcile,
  type AccountRow,
  buildAccountRows,
  type ConnectedMember,
  GIFT_WINDOW_DAYS,
  type GiftTransactionWindow,
  giftWindowStart,
  type JointAccountReconcile,
  membersToSync,
  runSync,
  type SyncDeps,
  UP_GIFT_CATEGORY,
} from './sync.ts'
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

/** A gift-category Up transaction on `accountId`. */
function transaction(id = 'tx-1', accountId = 'acc-1'): UpTransaction {
  return {
    id,
    attributes: {
      status: 'SETTLED',
      description: 'Gift shop',
      amount: { currencyCode: 'AUD', value: '-40.00', valueInBaseUnits: -40_00 },
      createdAt: '2026-06-01T08:00:00+10:00',
      settledAt: '2026-06-01T09:00:00+10:00',
    },
    relationships: {
      account: { data: { id: accountId } },
      category: { data: { id: UP_GIFT_CATEGORY } },
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
    listGiftTransactions: () => Promise.resolve([]),
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
    syncGiftTransactions: () => Promise.resolve(),
    ...overrides,
  }
}

/** Records every gift window a run settles. */
function recordWindows(windows: GiftTransactionWindow[]): Partial<SyncDeps> {
  return {
    syncGiftTransactions: (window) => {
      windows.push(window)
      return Promise.resolve()
    },
  }
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

Deno.test('runSync polls the gift window from the same instant it prunes from', async () => {
  const windows: GiftTransactionWindow[] = []
  let polledSince: Date | undefined
  await runSync(deps({
    ...recordWindows(windows),
    listGiftTransactions: (_token, since) => {
      polledSince = since
      return Promise.resolve([])
    },
  }))

  // Both the Up filter and the prune's floor are the one trailing window start.
  assertEquals(polledSince?.toISOString(), windows[0].since)
  const drift = Math.abs(new Date(windows[0].since).getTime() - giftWindowStart().getTime())
  assertEquals(drift < 1000, true)
})

Deno.test('runSync settles one gift window per member, scoped to that member', async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const joint = account({ ownershipType: 'JOINT', displayName: '2Up' }, 'joint-1')
  const windows: GiftTransactionWindow[] = []
  await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    listAccounts: (token) => Promise.resolve([joint, account({}, `${token}-own`)]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    ...recordWindows(windows),
  }))

  assertEquals(windows.length, 2)
  // Each window covers exactly the accounts that member's token can see — the
  // joint account plus their own — so the prune reaches neither less nor more.
  // The joint account is in both, though the account upsert deduped it to one row.
  assertEquals(windows[0].accountIds, ['local-joint-1', 'local-tok-m-1-own'])
  assertEquals(windows[1].accountIds, ['local-joint-1', 'local-tok-m-2-own'])
  assertEquals(windows.map((w) => w.householdId), ['h-1', 'h-1'])
})

Deno.test('runSync maps the polled transactions into the window and counts them', async () => {
  const windows: GiftTransactionWindow[] = []
  const result = await runSync(deps({
    listGiftTransactions: () =>
      Promise.resolve([transaction('tx-1'), transaction('tx-2', 'acc-unsynced')]),
    ...recordWindows(windows),
  }))

  // The transaction on an account the pass did not sync is skipped, not fatal.
  assertEquals(result.transactions, 1)
  assertEquals(windows[0].rows.map((row) => row.external_id), ['tx-1'])
  assertEquals(windows[0].rows[0], {
    household_id: 'h-1',
    account_id: 'local-acc-1',
    member_id: 'm-1',
    external_id: 'tx-1',
    external_category: 'gifts-and-charity',
    posted_at: '2026-06-01T09:00:00+10:00',
    amount_cents: -40_00,
    description: 'Gift shop',
    kind: 'expense',
    status: 'settled',
  })
})

Deno.test('runSync settles an empty window so the prune still runs', async () => {
  const windows: GiftTransactionWindow[] = []
  // Nothing in the category means the window holds no candidates at all — the
  // case where the last gift purchase was recategorised away in the Up app.
  const result = await runSync(deps(recordWindows(windows)))

  assertEquals(result.transactions, 0)
  assertEquals(windows.length, 1)
  assertEquals(windows[0].rows, [])
  assertEquals(windows[0].accountIds, ['local-acc-1'])
})

Deno.test('runSync settles no gift window for a member whose token is unreadable', async () => {
  const windows: GiftTransactionWindow[] = []
  await runSync(deps({ tokenFor: () => Promise.resolve(null), ...recordWindows(windows) }))
  assertEquals(windows.length, 0)
})

Deno.test("runSync keeps going when one member's gift window fails", async () => {
  const sam: ConnectedMember = { memberId: 'm-2', householdId: 'h-1', name: 'Sam' }
  const windows: GiftTransactionWindow[] = []
  const result = await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    listAccounts: (token) => Promise.resolve([account({}, `${token}-own`)]),
    listGiftTransactions: (token) =>
      token === 'tok-m-1'
        ? Promise.reject(new Error('Up API 429'))
        : Promise.resolve([transaction('tx-1', 'tok-m-2-own')]),
    ...recordWindows(windows),
  }))

  // Alex's window is lost; Sam's is settled and both members' balances stand.
  assertEquals(result, { members: 2, accounts: 2, transactions: 1 })
  assertEquals(windows.length, 1)
  assertEquals(windows[0].rows.map((row) => row.external_id), ['tx-1'])
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
  const windows: GiftTransactionWindow[] = []
  const result = await runSync(deps({
    listConnectedMembers: () => Promise.resolve([member, sam]),
    tokenFor: (id) => Promise.resolve(`tok-${id}`),
    listAccounts: (token) => Promise.resolve([account({}, `${token}-own`)]),
    reconcileAccounts: (reconcile) =>
      reconcile.memberId === 'm-1'
        ? Promise.reject(new Error('reconcile RPC 500'))
        : Promise.resolve(),
    ...recordWindows(windows),
  }))

  // Both members' balances and gift windows still land.
  assertEquals(result, { members: 2, accounts: 2, transactions: 0 })
  assertEquals(windows.length, 2)
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
