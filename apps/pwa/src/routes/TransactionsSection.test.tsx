import { MemoryRouter, useLocation } from 'react-router-dom'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionFilters } from '../lib/transactionList'
import { render, screen } from '../test/render'
import { TransactionsSection } from './TransactionsSection'

const hooks = vi.hoisted(() => ({
  useTransactionList: vi.fn(),
  useReviewTransaction: vi.fn(),
  useUpCategories: vi.fn(),
  useAccountDirectory: vi.fn(),
  useMembers: vi.fn(),
  useDeductedTransactionIds: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useTransactionList', () => ({ useTransactionList: hooks.useTransactionList }))
vi.mock('../hooks/useTransactionReview', () => ({
  useReviewTransaction: hooks.useReviewTransaction,
  useUpCategories: hooks.useUpCategories,
}))
vi.mock('../hooks/useAccountDirectory', () => ({
  useAccountDirectory: hooks.useAccountDirectory,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useDeductionTransactions', () => ({
  useDeductedTransactionIds: hooks.useDeductedTransactionIds,
}))
vi.mock('../components/TransactionListScreen', () => ({
  TransactionListScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="list-screen" />
  },
}))

const review = vi.fn()
const loadMore = vi.fn()

function Search() {
  return <div data-testid="search">{useLocation().search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TransactionsSection />
      <Search />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hooks.useTransactionList.mockReturnValue({
    transactions: [],
    loading: false,
    hasMore: true,
    loadingMore: false,
    loadMore,
  })
  hooks.useReviewTransaction.mockReturnValue(review)
  hooks.useUpCategories.mockReturnValue({ categories: [], loading: false })
  hooks.useAccountDirectory.mockReturnValue({
    accounts: [{ id: 'a1', name: '💸 Spending' }],
    loading: false,
  })
  hooks.useMembers.mockReturnValue({ members: [], loading: false })
  hooks.useDeductedTransactionIds.mockReturnValue({ ids: new Set(['t9']), loading: false })
})

describe('TransactionsSection', () => {
  it('shows the loading screen until every read lands', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    renderAt('/transactions')
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('reads the filters from the URL and passes everything through', () => {
    renderAt('/transactions?kind=expense&status=pending')
    expect(hooks.useTransactionList).toHaveBeenCalledWith({
      account: null,
      from: null,
      to: null,
      kind: 'expense',
      status: 'pending',
      category: null,
    })
    expect(hooks.screenProps).toMatchObject({
      transactions: [],
      categories: [],
      accountNames: { a1: 'Spending' },
      members: [],
      deductedIds: new Set(['t9']),
      hasMore: true,
      loadingMore: false,
      onLoadMore: loadMore,
      onReview: review,
    })
  })

  it('writes a filter change back to the URL', () => {
    renderAt('/transactions')
    const onFiltersChange = hooks.screenProps!.onFiltersChange as (f: TransactionFilters) => void
    act(() =>
      onFiltersChange({
        account: 'a1',
        from: null,
        to: null,
        kind: null,
        status: null,
        category: 'none',
      }),
    )
    expect(screen.getByTestId('search')).toHaveTextContent('?account=a1&category=none')
  })
})
