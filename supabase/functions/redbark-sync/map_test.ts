import { assertEquals } from '@std/assert'
import { accountName, mapAccount, mapAccountType } from './map.ts'
import type { RedbarkAccount, RedbarkBalance } from '../_shared/redbark.ts'

function account(overrides: Partial<RedbarkAccount> = {}): RedbarkAccount {
  return {
    id: 'acc-1',
    connection: 'conn-1',
    provider: 'fiskil',
    category: 'banking',
    name: 'Everyday',
    type: 'TRANSACTION_AND_SAVINGS_ACCOUNT',
    account_number: '***1234',
    currency: 'AUD',
    institution: { id: 'inst-1', name: 'Big Bank', logo: null },
    status: 'active',
    ...overrides,
  }
}

function balance(overrides: Partial<RedbarkBalance> = {}): RedbarkBalance {
  return {
    account: 'acc-1',
    current: { amount: 12345, currency: 'aud' },
    available: null,
    currency: 'aud',
    observed_at: '2026-09-14T00:00:00Z',
    freshness: 'live',
    ...overrides,
  }
}

Deno.test('mapAccountType matches "saving"/"save" to savings', () => {
  assertEquals(mapAccountType({ type: 'SAVINGS_ACCOUNT', name: 'Rainy Day' }), 'savings')
  assertEquals(mapAccountType({ type: 'x', name: 'Save for a house' }), 'savings')
})

Deno.test('mapAccountType matches "loan"/"mortgage" to home_loan', () => {
  assertEquals(mapAccountType({ type: 'HOME_LOAN', name: 'x' }), 'home_loan')
  assertEquals(mapAccountType({ type: 'x', name: 'Mortgage Offset' }), 'home_loan')
})

Deno.test('mapAccountType matches "credit"/"card" to credit', () => {
  assertEquals(mapAccountType({ type: 'CREDIT_CARD', name: 'x' }), 'credit')
  assertEquals(mapAccountType({ type: 'x', name: 'Rewards Card' }), 'credit')
})

Deno.test('mapAccountType matches "offset" to offset', () => {
  assertEquals(mapAccountType({ type: 'OFFSET_ACCOUNT', name: 'x' }), 'offset')
})

Deno.test('mapAccountType matches "transaction"/"everyday"/"checking"/"current" to transaction', () => {
  assertEquals(mapAccountType({ type: 'TRANSACTION_ACCOUNT', name: 'x' }), 'transaction')
  assertEquals(mapAccountType({ type: 'x', name: 'Everyday' }), 'transaction')
  assertEquals(mapAccountType({ type: 'CHECKING', name: 'x' }), 'transaction')
  assertEquals(mapAccountType({ type: 'x', name: 'Current Account' }), 'transaction')
})

Deno.test('mapAccountType falls back to other when nothing matches', () => {
  assertEquals(mapAccountType({ type: 'MYSTERY', name: 'Something Else' }), 'other')
})

Deno.test('mapAccountType is case-insensitive', () => {
  assertEquals(mapAccountType({ type: 'x', name: 'SAVINGS' }), 'savings')
})

Deno.test('mapAccountType prefers a home_loan match over a later offset match', () => {
  assertEquals(mapAccountType({ type: 'x', name: 'Home Loan Offset' }), 'home_loan')
})

Deno.test('accountName prefixes a mapped transaction account with the owner name', () => {
  assertEquals(accountName(account(), 'Alex', 'transaction'), "Alex's Everyday")
})

Deno.test('accountName leaves a non-transaction account unprefixed', () => {
  assertEquals(accountName(account({ name: 'Rainy Day' }), 'Alex', 'savings'), 'Rainy Day')
})

Deno.test('mapAccount maps a transaction account with cents passed through', () => {
  assertEquals(
    mapAccount(account({ type: 'TRANSACTION_ACCOUNT' }), balance(), 'Alex'),
    {
      external_id: 'acc-1',
      name: "Alex's Everyday",
      type: 'transaction',
      balance_cents: 12345,
      currency: 'AUD',
      source: 'redbark',
    },
  )
})

Deno.test('mapAccount uppercases the currency', () => {
  assertEquals(mapAccount(account(), balance({ currency: 'aud' }), 'Alex').currency, 'AUD')
})

Deno.test("mapAccount falls back to the account's own currency when the balance omits one", () => {
  assertEquals(
    mapAccount(
      account({ currency: 'nzd' }),
      balance({ currency: undefined as unknown as string }),
      'Alex',
    )
      .currency,
    'NZD',
  )
})
