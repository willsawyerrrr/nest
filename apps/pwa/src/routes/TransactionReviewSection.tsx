import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LoadingScreen } from '../components/LoadingScreen'
import { TransactionReviewScreen } from '../components/TransactionReviewScreen'
import { useAccountDirectory } from '../hooks/useAccountDirectory'
import { useDeductedTransactionIds } from '../hooks/useDeductionTransactions'
import { useTransactionReview } from '../hooks/useTransactionReview'
import { accountLabel } from '../lib/accountName'

/** `/transactions/review`, with an optional `?id=` naming the transaction to focus. */
export function TransactionReviewSection() {
  const [params] = useSearchParams()
  const review = useTransactionReview(params.get('id'))
  const { accounts, loading: accountsLoading } = useAccountDirectory()
  const deducted = useDeductedTransactionIds()

  const accountNames = useMemo(
    () =>
      Object.fromEntries(
        (accounts ?? []).map((account) => [account.id, accountLabel(account.name)]),
      ),
    [accounts],
  )

  if (review.loading || accountsLoading || deducted.loading) {
    return <LoadingScreen />
  }

  return (
    <TransactionReviewScreen
      transactions={review.transactions ?? []}
      focused={review.focused}
      categories={review.categories ?? []}
      accountNames={accountNames}
      {...(deducted.ids && { deductedIds: deducted.ids })}
      onReview={review.review}
      onReviewMany={review.reviewMany}
      onCategoriseMany={review.categoriseMany}
    />
  )
}
