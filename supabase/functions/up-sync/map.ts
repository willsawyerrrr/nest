/**
 * Pure mappers from Up API resources to household ledger upsert rows. Kept in a
 * server-free module so they can be unit-tested without starting the function.
 */

import type { UpAccount, UpTransaction } from '../_shared/up.ts'

/** A row shaped for upsert into public.accounts (source = 'up'). */
export interface AccountUpsert {
  external_id: string
  name: string
  type: 'transaction' | 'savings' | 'home_loan' | 'other'
  balance_cents: number
  currency: string
  source: 'up'
}

/**
 * A row shaped for the `sync_up_transactions` RPC (source = 'up'). It carries no
 * `notes`: that column belongs to the household, and the sync never writes it.
 */
export interface TransactionUpsert {
  household_id: string
  account_id: string
  member_id: string | null
  external_id: string
  external_category: string | null
  external_parent_category: string | null
  is_categorizable: boolean
  transaction_type: string | null
  deep_link_url: string
  up_message: string | null
  up_note: string | null
  performing_customer_name: string | null
  posted_at: string
  amount_cents: number
  description: string
  kind: 'income' | 'expense' | 'transfer'
  status: 'pending' | 'settled'
}

/** A local ledger account already synced from Up, keyed by its Up account id. */
export interface SyncedAccount {
  /** Up's account id, as a transaction's `account` relationship names it. */
  external_id: string
  /** The local `accounts.id`. */
  id: string
  household_id: string
  /** Null for a joint account, which is shared across the household. */
  owner_member_id: string | null
}

/** Maps an Up account to a ledger account row. */
export function mapAccount(account: UpAccount): AccountUpsert {
  const typeByUp: Record<UpAccount['attributes']['accountType'], AccountUpsert['type']> = {
    TRANSACTIONAL: 'transaction',
    SAVER: 'savings',
    HOME_LOAN: 'home_loan',
  }
  return {
    external_id: account.id,
    name: account.attributes.displayName,
    type: typeByUp[account.attributes.accountType],
    balance_cents: account.attributes.balance.valueInBaseUnits,
    currency: account.attributes.balance.currencyCode,
    source: 'up',
  }
}

/**
 * Maps an Up transaction to a ledger transaction row, resolving its account from
 * `accounts` (keyed by Up account id) so household and member attribution come
 * from the account the money moved through — `member_id` is the account's owner,
 * null for a joint account, mirroring how the account itself is attributed.
 * Returns null when the account is absent, which is what happens before the
 * account pass has landed it or when the token cannot see it; such a transaction
 * is skipped rather than failing the pass.
 *
 * Amounts stay exactly as Up signs them, a debit negative, so a `HELD` amount
 * revised on settlement carries through unchanged. `posted_at` is the settlement
 * instant once there is one and the creation instant while the hold stands. A
 * transaction naming a `transferAccount` moved money between the owner's own
 * accounts and is a `transfer`; otherwise its sign makes it an expense or income.
 */
export function mapTransaction(
  tx: UpTransaction,
  accounts: ReadonlyMap<string, SyncedAccount>,
): TransactionUpsert | null {
  const account = accounts.get(tx.relationships.account.data.id)
  if (!account) return null

  const { attributes, relationships } = tx
  const amountCents = attributes.amount.valueInBaseUnits
  return {
    household_id: account.household_id,
    account_id: account.id,
    member_id: account.owner_member_id,
    external_id: tx.id,
    external_category: relationships.category.data?.id ?? null,
    external_parent_category: relationships.parentCategory.data?.id ?? null,
    is_categorizable: attributes.isCategorizable,
    transaction_type: attributes.transactionType,
    deep_link_url: attributes.deepLinkURL,
    up_message: attributes.message,
    up_note: attributes.note?.text ?? null,
    performing_customer_name: attributes.performingCustomer?.displayName ?? null,
    posted_at: attributes.settledAt ?? attributes.createdAt,
    amount_cents: amountCents,
    description: attributes.description,
    kind: relationships.transferAccount.data ? 'transfer' : amountCents < 0 ? 'expense' : 'income',
    status: attributes.status === 'SETTLED' ? 'settled' : 'pending',
  }
}
