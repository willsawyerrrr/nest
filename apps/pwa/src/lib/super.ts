import type { Account } from '../hooks/useAccounts'
import type { SuperProfile } from '../hooks/useSuperProfiles'

/**
 * The account name for a member's super: the fund name when given, otherwise a
 * "<member> Super" fallback so the account is still identifiable.
 */
export function superAccountName(fundName: string | null, memberName: string): string {
  const trimmed = fundName?.trim()
  return trimmed ? trimmed : `${memberName} Super`
}

/** The set of account ids linked as a member's super balance, across all profiles. */
export function superAccountIds(profiles: readonly SuperProfile[]): Set<string> {
  return new Set(
    profiles.map((profile) => profile.linked_account_id).filter((id): id is string => id !== null),
  )
}

/** Net worth split into super vs other accounts, each with a subtotal and a grand total. */
export interface NetWorthBreakdown {
  superAccounts: Account[]
  otherAccounts: Account[]
  superTotalCents: number
  otherTotalCents: number
  totalCents: number
}

/** The sum of every account's `balance_cents`. */
function sumBalances(accounts: readonly Account[]): number {
  return accounts.reduce((total, account) => total + account.balance_cents, 0)
}

/**
 * Splits `accounts` into super accounts (those whose id is a `super_account_id`)
 * and everything else, with per-group subtotals and the assets-only grand total.
 */
export function netWorthBreakdown(
  accounts: readonly Account[],
  superIds: ReadonlySet<string>,
): NetWorthBreakdown {
  const superAccounts = accounts.filter((account) => superIds.has(account.id))
  const otherAccounts = accounts.filter((account) => !superIds.has(account.id))
  const superTotalCents = sumBalances(superAccounts)
  const otherTotalCents = sumBalances(otherAccounts)
  return {
    superAccounts,
    otherAccounts,
    superTotalCents,
    otherTotalCents,
    totalCents: superTotalCents + otherTotalCents,
  }
}
