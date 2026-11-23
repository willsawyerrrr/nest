import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionFilters } from '../lib/transactionList'
import type { UpCategory } from '../lib/transactionReview'
import { makeMember, makeReviewTransaction } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { TransactionListScreen } from './TransactionListScreen'

const categories: UpCategory[] = [
  { id: 'good-life', name: 'Good Life', parent_id: null },
  { id: 'restaurants-and-cafes', name: 'Restaurants & Cafes', parent_id: 'good-life' },
]

const NONE: TransactionFilters = {
  account: null,
  from: null,
  to: null,
  kind: null,
  status: null,
  category: null,
}

const onFiltersChange = vi.fn()
const onLoadMore = vi.fn()
const onReview = vi.fn()

function renderScreen(props: Partial<Parameters<typeof TransactionListScreen>[0]> = {}) {
  return render(
    <MemoryRouter>
      <TransactionListScreen
        transactions={[makeReviewTransaction()]}
        categories={categories}
        accountNames={{ a1: 'Spending', a2: 'Joint' }}
        members={[makeMember({ id: 'm1', name: 'Will' })]}
        filters={NONE}
        onFiltersChange={onFiltersChange}
        hasMore={false}
        loadingMore={false}
        onLoadMore={onLoadMore}
        onReview={onReview}
        {...props}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  onReview.mockResolvedValue(undefined)
})

describe('TransactionListScreen', () => {
  it('says when there are no transactions at all', () => {
    renderScreen({ transactions: [] })
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('says when no transaction matches the filters, and clears them', async () => {
    renderScreen({ transactions: [], filters: { ...NONE, kind: 'income' } })
    expect(screen.getByText('No transactions match these filters.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onFiltersChange).toHaveBeenCalledWith(NONE)
  })

  it("tags each row with whose it is: the owner's name, or Joint", () => {
    renderScreen({
      transactions: [
        makeReviewTransaction({ id: 't1', member_id: 'm1' }),
        makeReviewTransaction({
          id: 't2',
          account_id: 'a2',
          member_id: null,
          performing_customer_name: '$alex',
        }),
      ],
    })
    const [own, joint] = screen.getAllByTestId('transaction-row')
    expect(within(own!).getByText('Will')).toBeInTheDocument()
    expect(within(joint!).getByText('Joint · $alex')).toBeInTheDocument()
  })

  it('shows the row summary and opens the review form', async () => {
    renderScreen({ transactions: [makeReviewTransaction({ status: 'pending' })] })
    const row = screen.getByTestId('transaction-row')
    expect(within(row).getByText('-$42.50')).toBeInTheDocument()
    expect(within(row).getByText('Pending')).toBeInTheDocument()
    expect(within(row).getByText('Good Life › Restaurants & Cafes')).toBeInTheDocument()

    await userEvent.click(within(row).getByRole('button', { name: /Cafe Lune/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Looks right' }))
    expect(onReview).toHaveBeenCalledWith('t1', { note: '' })
  })

  it('changes a filter', async () => {
    renderScreen()
    await userEvent.click(screen.getByRole('combobox', { name: 'Kind' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Transfer' }))
    expect(onFiltersChange).toHaveBeenCalledWith({ ...NONE, kind: 'transfer' })
  })

  it('offers Load more only while an older page may remain', async () => {
    const { rerender } = renderScreen()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <TransactionListScreen
          transactions={[makeReviewTransaction()]}
          categories={categories}
          accountNames={{ a1: 'Spending' }}
          members={[]}
          filters={NONE}
          onFiltersChange={onFiltersChange}
          hasMore
          loadingMore={false}
          onLoadMore={onLoadMore}
          onReview={onReview}
        />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadMore).toHaveBeenCalled()
  })
})
