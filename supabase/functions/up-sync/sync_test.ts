import { assertEquals } from '@std/assert'
import {
  accountName,
  type AccountRow,
  buildAccountRows,
  type ConnectedMember,
  membersToSync,
  runSync,
  type SyncDeps,
} from './sync.ts'
import type { UpAccount } from '../_shared/up.ts'

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
      name: 'Alex Spending',
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
  assertEquals(accountName(account(), member, false), 'Alex Spending')
})

Deno.test('accountName is idempotent: recomputed from Up it never double-prefixes', () => {
  // Up always returns the raw "Spending"; recomputing each sync keeps the name
  // stable rather than compounding to "Alex Alex Spending".
  assertEquals(accountName(account(), member, false), 'Alex Spending')
  assertEquals(accountName(account(), member, false), 'Alex Spending')
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

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    listConnectedMembers: () => Promise.resolve([member]),
    tokenFor: () => Promise.resolve('tok'),
    listAccounts: () => Promise.resolve([account()]),
    upsertAccounts: () => Promise.resolve(),
    ...overrides,
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

  assertEquals(result, { members: 2, accounts: 4 })
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
  assertEquals(result, { members: 2, accounts: 3 })
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

  assertEquals(result, { members: 1, accounts: 1 })
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

  assertEquals(result, { members: 1, accounts: 0 })
  assertEquals(upserts, 0)
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

  assertEquals(result, { members: 1, accounts: 0 })
  assertEquals(upserts, 0)
})
