import { useCallback } from 'react'
import {
  GIFT_TRANSACTION_CATEGORY,
  type GiftTransaction,
  type GiftTransactionDismissal,
} from '../lib/giftCandidates'
import { useHouseholdCollection } from './useCollection'

/** The dismissal fields a caller supplies; the household is set by the hook. */
export interface GiftDismissalInput {
  transaction_id: string
}

export interface UseGiftTransactionsResult {
  /** The household's synced gift-category transactions, newest first. */
  transactions: GiftTransaction[] | null
  dismissals: GiftTransactionDismissal[] | null
  loading: boolean
  reload: () => Promise<void>
  /** Sets a candidate aside as "not a gift". */
  dismiss: (transactionId: string) => Promise<void>
  /** Undoes a dismissal, returning its transaction to the inbox. */
  restore: (dismissalId: string) => Promise<void>
}

/**
 * Loads the gift-category transactions `up-sync` ingests, plus the dismissals
 * that keep the ones that were not gifts out of the inbox, and creates and
 * removes those dismissals.
 *
 * RLS scopes both reads: a transaction arrives only for an account whose
 * balances the signed-in member may see, so a gift bought on a co-member's
 * spending account never reaches them, and a transaction the household has
 * claimed as a gift for them is withheld whichever account paid for it. A
 * dismissal write invalidates the transactions cache alongside its own, keeping
 * the inbox in step.
 */
export function useGiftTransactions(): UseGiftTransactionsResult {
  const { rows: transactionRows, reload: reloadTransactions } = useHouseholdCollection<
    'transactions',
    never
  >({
    table: 'transactions',
    match: { external_category: GIFT_TRANSACTION_CATEGORY },
    orderBy: 'posted_at',
    descending: true,
  })
  const {
    rows: dismissalRows,
    reload: reloadDismissals,
    create: createDismissal,
    remove: restore,
  } = useHouseholdCollection<'gift_transaction_dismissal', GiftDismissalInput>({
    table: 'gift_transaction_dismissal',
    alsoInvalidate: ['transactions'],
  })

  const reload = useCallback(async () => {
    await Promise.all([reloadTransactions(), reloadDismissals()])
  }, [reloadTransactions, reloadDismissals])

  const dismiss = useCallback(
    async (transactionId: string) => {
      await createDismissal({ transaction_id: transactionId })
    },
    [createDismissal],
  )

  return {
    transactions: transactionRows,
    dismissals: dismissalRows,
    loading: transactionRows === null || dismissalRows === null,
    reload,
    dismiss,
    restore,
  }
}
