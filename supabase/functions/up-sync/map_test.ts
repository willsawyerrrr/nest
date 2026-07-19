import { assertEquals } from '@std/assert'
import { mapAccount, mapTransaction } from './map.ts'
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
  accountId = 'acc-1',
): UpTransaction {
  return {
    id: 'tx-1',
    attributes: {
      status: 'SETTLED',
      description: 'Coffee',
      message: null,
      amount: { currencyCode: 'AUD', value: '-4.50', valueInBaseUnits: -450 },
      createdAt: '2026-01-02T08:00:00+11:00',
      settledAt: '2026-01-02T09:00:00+11:00',
      ...attrs,
    },
    relationships: {
      account: { data: { id: accountId } },
      category: { data: null },
    },
  }
}

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

Deno.test('mapTransaction maps a settled expense', () => {
  assertEquals(mapTransaction(transaction()), {
    external_id: 'tx-1',
    account_external_id: 'acc-1',
    posted_at: '2026-01-02T09:00:00+11:00',
    amount_cents: -450,
    description: 'Coffee',
    kind: 'expense',
    status: 'settled',
    source: 'up',
  })
})

Deno.test('mapTransaction treats a non-negative amount as income', () => {
  assertEquals(
    mapTransaction(
      transaction({ amount: { currencyCode: 'AUD', value: '10.00', valueInBaseUnits: 1000 } }),
    ).kind,
    'income',
  )
})

Deno.test('mapTransaction maps a HELD transaction to pending', () => {
  assertEquals(mapTransaction(transaction({ status: 'HELD' })).status, 'pending')
})

Deno.test('mapTransaction falls back to createdAt when settledAt is null', () => {
  assertEquals(
    mapTransaction(transaction({ settledAt: null })).posted_at,
    '2026-01-02T08:00:00+11:00',
  )
})
