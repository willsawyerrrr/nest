import { assertEquals } from '@std/assert'
import { isAutomaticTransfer, mapAccount, mapTransaction, type SyncedAccount } from './map.ts'
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
  {
    accountId = 'acc-1',
    category = 'gifts-and-charity' as string | null,
    parentCategory = 'personal' as string | null,
    transferAccount = null as string | null,
  } = {},
): UpTransaction {
  return {
    id: 'tx-1',
    attributes: {
      status: 'SETTLED',
      description: 'Coffee',
      message: null,
      isCategorizable: true,
      amount: { currencyCode: 'AUD', value: '-4.50', valueInBaseUnits: -450 },
      createdAt: '2026-01-02T08:00:00+11:00',
      settledAt: '2026-01-02T09:00:00+11:00',
      transactionType: 'Purchase',
      deepLinkURL: 'up://transaction/tx-1',
      note: null,
      performingCustomer: { displayName: 'Alex' },
      ...attrs,
    },
    relationships: {
      account: { data: { id: accountId } },
      category: { data: category === null ? null : { id: category } },
      parentCategory: { data: parentCategory === null ? null : { id: parentCategory } },
      transferAccount: { data: transferAccount === null ? null : { id: transferAccount } },
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

Deno.test('mapAccount maps SAVER to savings and HOME_LOAN to home_loan', () => {
  assertEquals(mapAccount(account({ accountType: 'SAVER' })).type, 'savings')
  assertEquals(mapAccount(account({ accountType: 'HOME_LOAN' })).type, 'home_loan')
})

Deno.test('mapTransaction maps a settled expense, attributed to the account owner', () => {
  assertEquals(mapTransaction(transaction(), accounts), {
    household_id: 'h-1',
    account_id: 'local-acc-1',
    member_id: 'm-1',
    external_id: 'tx-1',
    external_category: 'gifts-and-charity',
    external_parent_category: 'personal',
    is_categorizable: true,
    transaction_type: 'Purchase',
    deep_link_url: 'up://transaction/tx-1',
    up_message: null,
    up_note: null,
    performing_customer_name: 'Alex',
    posted_at: '2026-01-02T08:00:00+11:00',
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

Deno.test('mapTransaction dates a transaction when it was made, held or settled', () => {
  for (const attrs of [{ status: 'HELD' as const, settledAt: null }, {}]) {
    assertEquals(
      mapTransaction(transaction(attrs), accounts)?.posted_at,
      '2026-01-02T08:00:00+11:00',
    )
  }
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

Deno.test('mapTransaction carries a null parent category through', () => {
  assertEquals(
    mapTransaction(transaction({}, { category: null, parentCategory: null }), accounts)
      ?.external_parent_category,
    null,
  )
})

Deno.test('mapTransaction maps a transaction naming a transfer account to transfer', () => {
  const row = mapTransaction(
    transaction({ isCategorizable: false }, { category: null, transferAccount: 'acc-2' }),
    accounts,
  )
  assertEquals(row?.kind, 'transfer')
  assertEquals(row?.is_categorizable, false)
})

Deno.test('mapTransaction maps an incoming transfer to transfer, not income', () => {
  assertEquals(
    mapTransaction(
      transaction(
        { amount: { currencyCode: 'AUD', value: '50.00', valueInBaseUnits: 50_00 } },
        { transferAccount: 'acc-2' },
      ),
      accounts,
    )?.kind,
    'transfer',
  )
})

Deno.test("mapTransaction carries Up's message and note into their own columns", () => {
  const row = mapTransaction(
    transaction({ message: 'Rent share', note: { text: 'Split with Sam' } }),
    accounts,
  )
  assertEquals(row?.up_message, 'Rent share')
  assertEquals(row?.up_note, 'Split with Sam')
  assertEquals('notes' in (row ?? {}), false)
})

Deno.test('mapTransaction leaves the performing customer null when Up omits it', () => {
  assertEquals(
    mapTransaction(transaction({ performingCustomer: null }), accounts)?.performing_customer_name,
    null,
  )
})

Deno.test('mapTransaction maps a transfer from outside the household to income', () => {
  const row = mapTransaction(
    transaction(
      {
        description: 'Transfer from $friend',
        isCategorizable: false,
        transactionType: 'Transfer',
        amount: { currencyCode: 'AUD', value: '25.00', valueInBaseUnits: 2500 },
      },
      { category: null },
    ),
    accounts,
  )
  assertEquals(row?.kind, 'income')
  assertEquals(row?.transaction_type, 'Transfer')
})

Deno.test('mapTransaction carries the Salary and Interest transaction types through', () => {
  for (const transactionType of ['Salary', 'Interest']) {
    const row = mapTransaction(
      transaction(
        { transactionType, amount: { currencyCode: 'AUD', value: '9.00', valueInBaseUnits: 900 } },
      ),
      accounts,
    )
    assertEquals(row?.kind, 'income')
    assertEquals(row?.transaction_type, transactionType)
  }
})

Deno.test('isAutomaticTransfer flags the moves Up makes on its own', () => {
  for (
    const [transactionType, description] of [
      ['Round Up', 'Round Up'],
      ['Round Up', 'Transfer to Emergency'],
      ['Scheduled Transfer', 'Auto Transfer to Water'],
      ['Transfer', 'Cover from Discretionary'],
      ['Transfer', 'Cover to 2Up Spending'],
      ['Transfer', 'Undo Cover from Discretionary'],
      ['Transfer', 'Forward to Emergency'],
      ['Transfer', 'Final interest payment from Holiday'],
      ['Transfer', 'Saved Up'],
    ]
  ) {
    assertEquals(
      isAutomaticTransfer(transaction({ transactionType, description })),
      true,
      description,
    )
  }
})

Deno.test('isAutomaticTransfer leaves transfers someone made, and other payments', () => {
  for (
    const [transactionType, description] of [
      ['Transfer', 'Transfer to Small Emergency'],
      ['Transfer', 'Transfer from $friend'],
      ['Transfer', 'Quick save transfer to Emergency'],
      ['Transfer', 'Top Up to Maybuy'],
      ['Purchase', 'Cover from Discretionary'],
      [null, 'Saved Up'],
    ] as const
  ) {
    assertEquals(
      isAutomaticTransfer(transaction({ transactionType, description })),
      false,
      description,
    )
  }
})

Deno.test('mapTransaction skips an automatic transfer', () => {
  const accounts = new Map([[ownAccount.external_id, ownAccount]])
  const cover = transaction({
    transactionType: 'Transfer',
    description: 'Cover from Discretionary',
  }, {
    transferAccount: 'acc-2',
  })
  assertEquals(mapTransaction(cover, accounts), null)
})
