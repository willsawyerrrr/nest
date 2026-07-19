/**
 * Pure mappers from Up API resources to household ledger upsert rows. Kept in a
 * server-free module so they can be unit-tested without starting the function.
 */

import type { UpAccount, UpTransaction } from '../_shared/up.ts'

/** A row shaped for upsert into public.accounts (source = 'up'). */
export interface AccountUpsert {
  external_id: string
  name: string
  type: 'transaction' | 'savings' | 'other'
  balance_cents: number
  currency: string
  source: 'up'
}

/** A row shaped for upsert into public.transactions (source = 'up'). */
export interface TransactionUpsert {
  external_id: string
  account_external_id: string
  posted_at: string
  amount_cents: number
  description: string
  kind: 'income' | 'expense'
  status: 'pending' | 'settled'
  source: 'up'
}

/** Maps an Up account to a ledger account row. */
export function mapAccount(account: UpAccount): AccountUpsert {
  const typeByUp: Record<UpAccount['attributes']['accountType'], AccountUpsert['type']> = {
    TRANSACTIONAL: 'transaction',
    SAVER: 'savings',
    HOME_LOAN: 'other',
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

/** Maps an Up transaction to a ledger transaction row. */
export function mapTransaction(tx: UpTransaction): TransactionUpsert {
  const amountCents = tx.attributes.amount.valueInBaseUnits
  return {
    external_id: tx.id,
    account_external_id: tx.relationships.account.data.id,
    posted_at: tx.attributes.settledAt ?? tx.attributes.createdAt,
    amount_cents: amountCents,
    description: tx.attributes.description,
    kind: amountCents < 0 ? 'expense' : 'income',
    status: tx.attributes.status === 'SETTLED' ? 'settled' : 'pending',
    source: 'up',
  }
}
