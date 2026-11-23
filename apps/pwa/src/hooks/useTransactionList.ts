import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useHouseholdId } from '../components/HouseholdProvider'
import { isoDaysBefore, localDayStart } from '../lib/dates'
import { supabase } from '../lib/supabase'
import {
  TRANSACTION_PAGE_SIZE,
  UNCATEGORISED,
  type TransactionFilters,
} from '../lib/transactionList'
import { REVIEW_TRANSACTION_COLUMNS, type ReviewTransaction } from '../lib/transactionReview'

export interface UseTransactionListResult {
  /** The loaded pages' transactions, newest first; null until the first page lands. */
  transactions: ReviewTransaction[] | null
  /** True until the first page lands; a filter change keeps the previous rows meanwhile. */
  loading: boolean
  /** Whether an older page may remain. */
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
}

/** One page of transactions matching `filters`, newest first. */
async function fetchPage(filters: TransactionFilters, page: number): Promise<ReviewTransaction[]> {
  let query = supabase.from('transactions').select(REVIEW_TRANSACTION_COLUMNS)
  if (filters.account !== null) {
    query = query.eq('account_id', filters.account)
  }
  if (filters.from !== null) {
    query = query.gte('posted_at', localDayStart(filters.from))
  }
  if (filters.to !== null) {
    query = query.lt('posted_at', localDayStart(isoDaysBefore(filters.to, -1)))
  }
  if (filters.kind !== null) {
    query = query.eq('kind', filters.kind)
  }
  if (filters.status !== null) {
    query = query.eq('status', filters.status)
  }
  if (filters.category === UNCATEGORISED) {
    query = query.is('external_category', null)
  } else if (filters.category !== null) {
    query = query.or(
      `external_category.eq.${filters.category},external_parent_category.eq.${filters.category}`,
    )
  }
  const start = page * TRANSACTION_PAGE_SIZE
  const { data, error } = await query
    .order('posted_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + TRANSACTION_PAGE_SIZE - 1)
  if (error) {
    throw error
  }
  return data as ReviewTransaction[]
}

/**
 * Loads every transaction the signed-in member can see — any source, status,
 * kind, or review state — matching `filters`, newest first, a page of
 * {@link TRANSACTION_PAGE_SIZE} at a time. RLS scopes the read to the member's
 * balance-visible accounts. Dates are local days: `to` includes all of its day.
 * A review invalidates the `transactions` prefix, so the list refetches.
 */
export function useTransactionList(filters: TransactionFilters): UseTransactionListResult {
  const householdId = useHouseholdId()
  const query = useInfiniteQuery({
    queryKey: ['transactions', householdId, 'list', filters],
    queryFn: ({ pageParam }) => fetchPage(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === TRANSACTION_PAGE_SIZE ? pages.length : undefined,
    placeholderData: keepPreviousData,
  })

  return {
    transactions: query.data?.pages.flat() ?? null,
    loading: query.isPending,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  }
}
