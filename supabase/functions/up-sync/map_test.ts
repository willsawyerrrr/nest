import { assertEquals } from '@std/assert'
import { mapAccount, mapTransaction, type SyncedAccount } from './map.ts'
import type { UpAccount, UpTransaction } from '../_shared/up.ts'

function account(overrides: Partial<UpAccount['attributes']> = {}): UpAccount {
  return {
    id: 'acc-1',
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

function transaction(
  attrs: Partial<UpTransaction['attributes']> = {},
  { accountId = 'acc-1', category = 'gifts-and-charity' as string | null } = {},
): UpTransaction {
  return {
    id: 'tx-1',
    attributes: {
      status: 'SETTLED',
      description: 'Coffee',
      amount: { currencyCode: 'AUD', value: '-4.50', valueInBaseUnits: -450 },
      createdAt: '2026-01-02T08:00:00+11:00',
      settledAt: '2026-01-02T09:00:00+11:00',
      ...attrs,
    },
    relationships: {
      account: { data: { id: accountId } },
      category: { data: category === null ? null : { id: category } },
    },
  }
}

/** The member's own spending account, as the account pass landed it. */
const ownAccount: SyncedAccount = {
  external_id: 'acc-1',
  id: 'local-acc-1',
  household_id: 'h-1',
  owner_member_id: 'm-1',
}

/** A joint account: shared across the household, so attributed to no member. */
const jointAccount: SyncedAccount = {
  external_id: 'acc-2',
  id: 'local-acc-2',
  household_id: 'h-1',
  owner_member_id: null,
}

const accounts = new Map([ownAccount, jointAccount].map((a) => [a.external_id, a]))

Deno.test('mapAccount maps a transactional account with cents passed through', () => {
  assertEquals(mapAccount(account()), {
    external_id: 'acc-1',
    name: 'Spending',
    type: 'transaction',
    balance_cents: 1234,
    currency: 'AUD',
    source: 'up',
  })
})

Deno.test('mapAccount maps SAVER to savings and HOME_LOAN to other', () => {
  assertEquals(mapAccount(account({ accountType: 'SAVER' })).type, 'savings')
  assertEquals(mapAccount(account({ accountType: 'HOME_LOAN' })).type, 'other')
})

Deno.test('mapTransaction maps a settled expense, attributed to the account owner', () => {
  assertEquals(mapTransaction(transaction(), accounts), {
    household_id: 'h-1',
    account_id: 'local-acc-1',
    member_id: 'm-1',
    external_id: 'tx-1',
    external_category: 'gifts-and-charity',
    posted_at: '2026-01-02T09:00:00+11:00',
    amount_cents: -450,
    description: 'Coffee',
    kind: 'expense',
    status: 'settled',
  })
})

Deno.test('mapTransaction leaves a joint-account transaction unattributed', () => {
  const row = mapTransaction(transaction({}, { accountId: 'acc-2' }), accounts)
  assertEquals(row?.account_id, 'local-acc-2')
  assertEquals(row?.member_id, null)
})

Deno.test('mapTransaction treats a non-negative amount as income', () => {
  assertEquals(
    mapTransaction(
      transaction({ amount: { currencyCode: 'AUD', value: '10.00', valueInBaseUnits: 1000 } }),
      accounts,
    )?.kind,
    'income',
  )
})

Deno.test("mapTransaction keeps Up's sign on a debit", () => {
  assertEquals(mapTransaction(transaction(), accounts)?.amount_cents, -450)
})

Deno.test('mapTransaction maps a HELD transaction to pending', () => {
  assertEquals(mapTransaction(transaction({ status: 'HELD' }), accounts)?.status, 'pending')
})

Deno.test('mapTransaction falls back to createdAt when settledAt is null', () => {
  assertEquals(
    mapTransaction(transaction({ settledAt: null }), accounts)?.posted_at,
    '2026-01-02T08:00:00+11:00',
  )
})

Deno.test('mapTransaction skips a transaction whose account is not synced', () => {
  // The account pass has not landed it, or the token cannot see it.
  assertEquals(mapTransaction(transaction({}, { accountId: 'acc-unknown' }), accounts), null)
})

Deno.test('mapTransaction carries a null category through', () => {
  assertEquals(
    mapTransaction(transaction({}, { category: null }), accounts)?.external_category,
    null,
  )
})
