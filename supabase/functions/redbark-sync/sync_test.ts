import { assertEquals } from '@std/assert'
import {
  type AccountReconcile,
  type AccountRow,
  type Connection,
  connectionsToSync,
  runSync,
  type SyncDeps,
} from './sync.ts'
import type { RedbarkAccount, RedbarkBalance } from '../_shared/redbark.ts'

function account(overrides: Partial<RedbarkAccount> = {}, id = 'acc-1'): RedbarkAccount {
  return {
    id,
    connection: 'conn-1',
    provider: 'fiskil',
    category: 'banking',
    name: 'Everyday',
    type: 'TRANSACTION_ACCOUNT',
    account_number: null,
    currency: 'AUD',
    institution: { id: 'inst-1', name: 'Big Bank', logo: null },
    status: 'active',
    ...overrides,
  }
}

function balance(amount = 1234): RedbarkBalance {
  return {
    account: 'acc-1',
    current: { amount, currency: 'aud' },
    available: null,
    currency: 'aud',
    observed_at: '2026-09-14T00:00:00Z',
    freshness: 'live',
  }
}

const connection: Connection = {
  id: 'conn-1',
  householdId: 'h-1',
  memberId: 'm-1',
  memberName: 'Alex',
}

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    listConnections: () => Promise.resolve([connection]),
    listAccounts: () => Promise.resolve([account()]),
    getBalance: () => Promise.resolve(balance()),
    upsertAccounts: () => Promise.resolve(),
    reconcileAccounts: () => Promise.resolve(),
    ...overrides,
  }
}

/** Records every reconcile a run runs. */
function recordReconciles(reconciles: AccountReconcile[]): Partial<SyncDeps> {
  return {
    reconcileAccounts: (reconcile) => {
      reconciles.push(reconcile)
      return Promise.resolve()
    },
  }
}

const otherConnection: Connection = {
  id: 'conn-2',
  householdId: 'h-2',
  memberId: 'm-2',
  memberName: 'Sam',
}

Deno.test('connectionsToSync passes every connection through for the cron path (null)', () => {
  assertEquals(connectionsToSync([connection, otherConnection], null), [
    connection,
    otherConnection,
  ])
})

Deno.test('connectionsToSync keeps only the caller household for a scoped call', () => {
  assertEquals(connectionsToSync([connection, otherConnection], 'h-1'), [connection])
})

Deno.test('connectionsToSync is empty when the caller household has no connections', () => {
  assertEquals(connectionsToSync([connection, otherConnection], 'h-3'), [])
})

Deno.test("runSync upserts a connection's banking accounts and counts them", async () => {
  const upserted: AccountRow[][] = []
  const result = await runSync(
    deps({
      upsertAccounts: (rows) => {
        upserted.push(rows)
        return Promise.resolve()
      },
    }),
  )

  assertEquals(result, { connections: 1, accounts: 1 })
  assertEquals(upserted, [[
    {
      external_id: 'acc-1',
      name: "Alex's Everyday",
      type: 'transaction',
      balance_cents: 1234,
      currency: 'AUD',
      source: 'redbark',
      household_id: 'h-1',
      owner_member_id: 'm-1',
    },
  ]])
})

Deno.test('runSync filters out brokerage accounts before fetching balances', async () => {
  let balanceCalls = 0
  const result = await runSync(
    deps({
      listAccounts: () =>
        Promise.resolve([
          account({ category: 'banking' }, 'bank-1'),
          account({ category: 'brokerage' }, 'broker-1'),
        ]),
      getBalance: () => {
        balanceCalls++
        return Promise.resolve(balance())
      },
    }),
  )

  assertEquals(balanceCalls, 1)
  assertEquals(result, { connections: 1, accounts: 1 })
})

Deno.test('runSync does not upsert when a connection has no banking accounts', async () => {
  let upserts = 0
  const result = await runSync(
    deps({
      listAccounts: () => Promise.resolve([account({ category: 'brokerage' })]),
      upsertAccounts: () => {
        upserts++
        return Promise.resolve()
      },
    }),
  )

  assertEquals(result, { connections: 1, accounts: 0 })
  assertEquals(upserts, 0)
})

Deno.test('runSync scoped to a household syncs only that household', async () => {
  const upserted: AccountRow[][] = []
  const result = await runSync(
    deps({
      listConnections: () => Promise.resolve([connection, otherConnection]),
      listAccounts: (connectionId) => Promise.resolve([account({}, `${connectionId}-a`)]),
      upsertAccounts: (rows) => {
        upserted.push(rows)
        return Promise.resolve()
      },
    }),
    'h-1',
  )

  assertEquals(result, { connections: 1, accounts: 1 })
  assertEquals(upserted.length, 1)
  assertEquals(upserted[0].map((r) => r.external_id), ['conn-1-a'])
})

Deno.test('runSync reconciles each member against the union of ids across their connections', async () => {
  const memberWithTwoConnections: Connection = {
    id: 'conn-1b',
    householdId: 'h-1',
    memberId: 'm-1',
    memberName: 'Alex',
  }
  const reconciles: AccountReconcile[] = []
  await runSync(deps({
    listConnections: () => Promise.resolve([connection, memberWithTwoConnections]),
    listAccounts: (connectionId) => Promise.resolve([account({}, `${connectionId}-acc`)]),
    ...recordReconciles(reconciles),
  }))

  assertEquals(reconciles, [
    { memberId: 'm-1', householdId: 'h-1', presentExternalIds: ['conn-1-acc', 'conn-1b-acc'] },
  ])
})

Deno.test('runSync reconciles one member per household independently', async () => {
  const reconciles: AccountReconcile[] = []
  await runSync(deps({
    listConnections: () => Promise.resolve([connection, otherConnection]),
    listAccounts: (connectionId) => Promise.resolve([account({}, `${connectionId}-acc`)]),
    ...recordReconciles(reconciles),
  }))

  assertEquals(reconciles, [
    { memberId: 'm-1', householdId: 'h-1', presentExternalIds: ['conn-1-acc'] },
    { memberId: 'm-2', householdId: 'h-2', presentExternalIds: ['conn-2-acc'] },
  ])
})

Deno.test('runSync reconciles a member with no banking accounts against an empty set', async () => {
  const reconciles: AccountReconcile[] = []
  await runSync(deps({
    listAccounts: () => Promise.resolve([]),
    ...recordReconciles(reconciles),
  }))

  assertEquals(reconciles, [{ memberId: 'm-1', householdId: 'h-1', presentExternalIds: [] }])
})

Deno.test("runSync keeps going when one member's reconcile fails", async () => {
  const reconciles: AccountReconcile[] = []
  const result = await runSync(deps({
    listConnections: () => Promise.resolve([connection, otherConnection]),
    listAccounts: (connectionId) => Promise.resolve([account({}, `${connectionId}-acc`)]),
    reconcileAccounts: (reconcile) => {
      if (reconcile.memberId === 'm-1') return Promise.reject(new Error('reconcile RPC 500'))
      reconciles.push(reconcile)
      return Promise.resolve()
    },
  }))

  // Both connections' balances still land; only m-1's reconcile is lost.
  assertEquals(result, { connections: 2, accounts: 2 })
  assertEquals(reconciles, [
    { memberId: 'm-2', householdId: 'h-2', presentExternalIds: ['conn-2-acc'] },
  ])
})

Deno.test('runSync has no connections to sync when there are none', async () => {
  const result = await runSync(deps({ listConnections: () => Promise.resolve([]) }))
  assertEquals(result, { connections: 0, accounts: 0 })
})
