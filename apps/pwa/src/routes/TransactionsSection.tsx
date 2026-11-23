import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LoadingScreen } from '../components/LoadingScreen'
import { TransactionListScreen } from '../components/TransactionListScreen'
import { useAccountDirectory } from '../hooks/useAccountDirectory'
import { useDeductedTransactionIds } from '../hooks/useDeductionTransactions'
import { useMembers } from '../hooks/useMembers'
import { useTransactionList } from '../hooks/useTransactionList'
import { useReviewTransaction, useUpCategories } from '../hooks/useTransactionReview'
import { accountLabel } from '../lib/accountName'
import {
  parseTransactionFilters,
  transactionFilterParams,
  type TransactionFilters,
} from '../lib/transactionList'

/** `/transactions`, its filters held in the URL's search params so a view is linkable. */
export function TransactionsSection() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => parseTransactionFilters(params), [params])
  const list = useTransactionList(filters)
  const review = useReviewTransaction()
  const { categories, loading: categoriesLoading } = useUpCategories()
  const { accounts, loading: accountsLoading } = useAccountDirectory()
  const { members, loading: membersLoading } = useMembers()
  const deducted = useDeductedTransactionIds()

  const accountNames = useMemo(
    () =>
      Object.fromEntries(
        (accounts ?? []).map((account) => [account.id, accountLabel(account.name)]),
      ),
    [accounts],
  )

  if (list.loading || categoriesLoading || accountsLoading || membersLoading || deducted.loading) {
    return <LoadingScreen />
  }

  return (
    <TransactionListScreen
      transactions={list.transactions ?? []}
      categories={categories ?? []}
      accountNames={accountNames}
      members={members ?? []}
      {...(deducted.ids && { deductedIds: deducted.ids })}
      filters={filters}
      onFiltersChange={(next: TransactionFilters) =>
        setParams(transactionFilterParams(next), { replace: true })
      }
      hasMore={list.hasMore}
      loadingMore={list.loadingMore}
      onLoadMore={list.loadMore}
      onReview={review}
    />
  )
}
