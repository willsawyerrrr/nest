import type { Member } from '../hooks/useMembers'
import type { Account, AccountType, LedgerSource } from './domain'
import { memberName } from './members'

/** The human label for every account type; `transaction` is Up's Spending account. */
const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  transaction: 'Spending',
  savings: 'Savings',
  offset: 'Offset',
  credit: 'Credit',
  home_loan: 'Home loan',
  other: 'Other',
}

/** The account types in display order: everyday money, then debts, then the rest. */
export const ACCOUNT_TYPE_ORDER: readonly AccountType[] = [
  'transaction',
  'savings',
  'offset',
  'credit',
  'home_loan',
  'other',
]

/** The human label for an account type. */
export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPE_LABELS[type]
}

const LEDGER_SOURCE_LABELS: Record<LedgerSource, string> = {
  up: 'Up',
  redbark: 'Redbark',
  manual: 'Manual',
}

/** The human label for where an account's data comes from. */
export function ledgerSourceLabel(source: LedgerSource): string {
  return LEDGER_SOURCE_LABELS[source]
}

/** Who an account belongs to: its owner's name, or `Joint` for a shared account. */
export function accountOwnerLabel(account: Account, members: Member[]): string {
  return account.owner_member_id === null ? 'Joint' : memberName(members, account.owner_member_id)
}

/** A run of accounts of one type, with the sum of their balances. */
export interface AccountTypeGroup {
  type: AccountType
  label: string
  accounts: Account[]
  totalCents: number
}

/**
 * The accounts grouped by type in {@link ACCOUNT_TYPE_ORDER}, keeping their
 * incoming order within each group and omitting empty types. Each total sums
 * every balance in the group, whether or not it counts toward net worth.
 */
export function groupAccountsByType(accounts: Account[]): AccountTypeGroup[] {
  return ACCOUNT_TYPE_ORDER.flatMap((type) => {
    const inType = accounts.filter((account) => account.type === type)
    if (inType.length === 0) {
      return []
    }
    return [
      {
        type,
        label: accountTypeLabel(type),
        accounts: inType,
        totalCents: inType.reduce((sum, account) => sum + account.balance_cents, 0),
      },
    ]
  })
}
