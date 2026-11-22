import { financialYearForDate } from '@nest/tax'
import type { Tables } from './database.types'
import { isoDate } from './dates'

/** The transaction columns a deduction is created from and shows as its source. */
export const SOURCE_TRANSACTION_COLUMNS = 'id,description,amount_cents,posted_at'

/** A ledger transaction as the deduction flow reads it. */
export type SourceTransaction = Pick<
  Tables<'transactions'>,
  'id' | 'description' | 'amount_cents' | 'posted_at'
>

/** The deduction form's starting values for a transaction, and the link it will store. */
export interface TransactionDeductionDraft {
  transactionId: string
  description: string
  /** The deductible figure in cents: the transaction's absolute amount. */
  amountCents: number
  /** The transaction's local posting date, `YYYY-MM-DD`. */
  deductionDate: string
  /** The financial year `deductionDate` falls in. */
  financialYear: number
}

/** A transaction's own words, falling back to a generic label for an unnamed one. */
export function transactionDescription(transaction: Pick<SourceTransaction, 'description'>) {
  return transaction.description || 'Card purchase'
}

/** Whether a transaction is an outflow, the only kind a deduction can come from. */
export function isOutflow(transaction: Pick<SourceTransaction, 'amount_cents'>): boolean {
  return transaction.amount_cents < 0
}

/** The Deductions screen route that opens the add form prefilled from a transaction. */
export function createDeductionPath(transactionId: string): string {
  return `/deductions?transaction=${encodeURIComponent(transactionId)}`
}

/**
 * The deduction form's starting values for `transaction`: its description, its
 * absolute amount (transactions are signed, an outflow negative), its local
 * posting date, and the financial year that date falls in.
 */
export function deductionDraftFromTransaction(
  transaction: SourceTransaction,
): TransactionDeductionDraft {
  const deductionDate = isoDate(new Date(transaction.posted_at))
  return {
    transactionId: transaction.id,
    description: transactionDescription(transaction),
    amountCents: Math.abs(transaction.amount_cents),
    deductionDate,
    financialYear: financialYearForDate(new Date(`${deductionDate}T00:00:00Z`)),
  }
}
