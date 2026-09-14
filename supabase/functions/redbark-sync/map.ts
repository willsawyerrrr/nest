/**
 * Pure mappers from Redbark API resources to household ledger upsert rows.
 * Kept in a server-free module so they can be unit-tested without starting the
 * function.
 */

import type { RedbarkAccount, RedbarkBalance } from '../_shared/redbark.ts'

/** A row shaped for upsert into public.accounts (source = 'redbark'). */
export interface AccountUpsert {
  external_id: string
  name: string
  type: 'transaction' | 'savings' | 'credit' | 'offset' | 'home_loan' | 'other'
  balance_cents: number
  currency: string
  source: 'redbark'
}

/**
 * Best-effort account-type heuristic, pending real Redbark response samples.
 * Redbark documents `AccountItem.type` as an open string with no enumerated
 * values, so this matches case-insensitively against the account's own `type`
 * and `name`: contains "saving"/"save" → `savings`; "loan"/"mortgage" →
 * `home_loan`; "credit"/"card" → `credit`; "offset" → `offset`;
 * "transaction"/"everyday"/"checking"/"current" → `transaction`; else
 * `other`. Checked in that order, so e.g. "Home Loan Offset" reads as
 * `home_loan` before the later `offset` match is reached.
 */
export function mapAccountType(
  account: Pick<RedbarkAccount, 'type' | 'name'>,
): AccountUpsert['type'] {
  const haystack = `${account.type} ${account.name}`.toLowerCase()
  if (/saving|save/.test(haystack)) return 'savings'
  if (/loan|mortgage/.test(haystack)) return 'home_loan'
  if (/credit|card/.test(haystack)) return 'credit'
  if (/offset/.test(haystack)) return 'offset'
  if (/transaction|everyday|checking|current/.test(haystack)) return 'transaction'
  return 'other'
}

/**
 * The stored name for an account. A mapped `transaction` account is prefixed
 * with the owning member's name in possessive form (e.g. "Alex's Everyday"),
 * mirroring up-sync/map.ts's `accountName` convention for disambiguating the
 * household's two spending accounts. Every Redbark connection — and so every
 * account under it — belongs to exactly one member (see redbark_connection's
 * comment), so unlike Up there is no joint/shared case to leave unprefixed.
 */
export function accountName(
  account: RedbarkAccount,
  memberName: string,
  type: AccountUpsert['type'],
): string {
  return type === 'transaction' ? `${memberName}'s ${account.name}` : account.name
}

/** Maps a Redbark banking account and its balance to a ledger account row. */
export function mapAccount(
  account: RedbarkAccount,
  balance: RedbarkBalance,
  memberName: string,
): AccountUpsert {
  const type = mapAccountType(account)
  return {
    external_id: account.id,
    name: accountName(account, memberName, type),
    type,
    balance_cents: balance.current.amount,
    currency: (balance.currency ?? account.currency).toUpperCase(),
    source: 'redbark',
  }
}
