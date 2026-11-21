import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewError, type ReviewTransaction, type UpCategory } from '../lib/transactionReview'
import { render, screen, setWideViewport, waitFor, within } from '../test/render'
import { TransactionReviewScreen } from './TransactionReviewScreen'

const categories: UpCategory[] = [
  { id: 'good-life', name: 'Good Life', parent_id: null },
  { id: 'home', name: 'Home', parent_id: null },
  { id: 'restaurants-and-cafes', name: 'Restaurants & Cafes', parent_id: 'good-life' },
  { id: 'gifts-and-charity', name: 'Gifts & Charity', parent_id: 'good-life' },
  { id: 'groceries', name: 'Groceries', parent_id: 'home' },
]

function makeTransaction(overrides: Partial<ReviewTransaction> = {}): ReviewTransaction {
  return {
    id: 't1',
    account_id: 'a1',
    amount_cents: -42_50,
    description: 'Cafe Lune',
    posted_at: '2026-11-20T02:30:00+00:00',
    status: 'settled',
    external_category: 'restaurants-and-cafes',
    external_parent_category: 'good-life',
    deep_link_url: 'up://transaction/up-t1',
    is_categorizable: true,
    up_message: null,
    up_note: null,
    notes: null,
    reviewed_at: null,
    ...overrides,
  }
}

const onReview = vi.fn()

function renderScreen(props: Partial<Parameters<typeof TransactionReviewScreen>[0]> = {}) {
  return render(
    <MemoryRouter>
      <TransactionReviewScreen
        transactions={[makeTransaction()]}
        focused={null}
        categories={categories}
        accountNames={{ a1: 'Spending' }}
        onReview={onReview}
        {...props}
      />
    </MemoryRouter>,
  )
}

async function expand(name: RegExp | string = /Cafe Lune/) {
  await userEvent.click(screen.getByRole('button', { name }))
}

beforeEach(() => {
  vi.clearAllMocks()
  onReview.mockResolvedValue(undefined)
})

describe('TransactionReviewScreen', () => {
  it('shows the empty state when nothing awaits review', () => {
    renderScreen({ transactions: [] })
    expect(screen.getByText('Nothing to review.')).toBeInTheDocument()
  })

  it('summarises each row: amount, account, date, category, pending, and Up words', () => {
    renderScreen({
      transactions: [
        makeTransaction({ status: 'pending', up_note: 'Split with Sam', up_message: 'Thanks!' }),
      ],
    })
    const row = screen.getByTestId('transaction-review-row')
    expect(within(row).getByText('Cafe Lune')).toBeInTheDocument()
    expect(within(row).getByText('-$42.50')).toBeInTheDocument()
    expect(within(row).getByText('Spending · 20 Nov 2026')).toBeInTheDocument()
    expect(within(row).getByText('Good Life › Restaurants & Cafes')).toBeInTheDocument()
    expect(within(row).getByText('Pending')).toBeInTheDocument()
    expect(within(row).getByText('Up note: Split with Sam')).toBeInTheDocument()
    expect(within(row).getByText('Up message: Thanks!')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'Open in Up' })).toHaveAttribute(
      'href',
      'up://transaction/up-t1',
    )
  })

  it('renders the dense row on wide screens', () => {
    setWideViewport()
    renderScreen()
    expect(screen.getByTestId('transaction-review-row')).toBeInTheDocument()
  })

  it('starts collapsed and expands to the review form', async () => {
    renderScreen()
    expect(screen.queryByRole('button', { name: 'Looks right' })).not.toBeInTheDocument()
    await expand()
    expect(screen.getByRole('button', { name: 'Looks right' })).toBeInTheDocument()
  })

  it('confirms with the note it was given', async () => {
    renderScreen({ transactions: [makeTransaction({ notes: 'Old' })] })
    await expand()
    const note = screen.getByLabelText('Nest note')
    expect(note).toHaveValue('Old')
    await userEvent.clear(note)
    await userEvent.type(note, 'Birthday dinner')
    await userEvent.click(screen.getByRole('button', { name: 'Looks right' }))
    expect(onReview).toHaveBeenCalledWith('t1', { note: 'Birthday dinner' })
  })

  it('saves a category change through Save, which needs a change', async () => {
    renderScreen()
    await expand()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await userEvent.click(screen.getByRole('combobox', { name: 'Category' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Groceries' }))

    expect(screen.getByRole('button', { name: 'Looks right' })).toBeDisabled()
    await userEvent.click(save)
    expect(onReview).toHaveBeenCalledWith('t1', { note: '', categoryId: 'groceries' })
  })

  it('saves a note change alone without touching the category', async () => {
    renderScreen()
    await expand()
    await userEvent.type(screen.getByLabelText('Nest note'), 'Work lunch')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onReview).toHaveBeenCalledWith('t1', { note: 'Work lunch' })
  })

  it('files a gift and points on to the Gifts inbox', async () => {
    renderScreen()
    await expand()
    await userEvent.click(screen.getByRole('button', { name: "It's a gift" }))
    expect(onReview).toHaveBeenCalledWith('t1', { note: '', categoryId: 'gifts-and-charity' })
    expect(await screen.findByRole('link', { name: 'Open Gifts' })).toHaveAttribute(
      'href',
      '/gifts',
    )
  })

  it('offers no gift action on a transaction already filed as one', async () => {
    renderScreen({ transactions: [makeTransaction({ external_category: 'gifts-and-charity' })] })
    await expand()
    expect(screen.queryByRole('button', { name: "It's a gift" })).not.toBeInTheDocument()
  })

  it('renders its own copy for a failure, linking to Connections when the fix is there', async () => {
    onReview.mockRejectedValue(new ReviewError('up_not_connected'))
    renderScreen()
    await expand()
    await userEvent.click(screen.getByRole('button', { name: "It's a gift" }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connect Up in Connections to change a category.',
    )
    expect(screen.getByRole('link', { name: 'Open Connections' })).toHaveAttribute(
      'href',
      '/settings/connections',
    )
    expect(screen.queryByRole('link', { name: 'Open Gifts' })).not.toBeInTheDocument()
  })

  it('falls back to generic copy for an unexpected failure', async () => {
    onReview.mockRejectedValue(new Error('boom'))
    renderScreen()
    await expand()
    await userEvent.click(screen.getByRole('button', { name: 'Looks right' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save this review. Try again.',
    )
  })

  it('leads with the focused transaction, expanded, even once reviewed', () => {
    renderScreen({
      focused: makeTransaction({
        id: 't2',
        description: 'Bookshop',
        reviewed_at: '2026-11-21T00:00:00Z',
      }),
    })
    const rows = screen.getAllByTestId('transaction-review-row')
    expect(within(rows[0]!).getByText('Bookshop')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Reviewed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bookshop/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: /Cafe Lune/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('does not repeat a focused transaction already in the list', () => {
    renderScreen({ focused: makeTransaction() })
    expect(screen.getAllByTestId('transaction-review-row')).toHaveLength(1)
  })

  it('disables the picker and gift action for an uncategorisable transaction', async () => {
    renderScreen({
      transactions: [makeTransaction({ is_categorizable: false, external_category: null })],
    })
    expect(screen.getByText('Uncategorised')).toBeInTheDocument()
    await expand()
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: "It's a gift" })).not.toBeInTheDocument()
  })

  it('omits Open in Up when Up gave no link, and says when the list is capped', () => {
    renderScreen({
      transactions: Array.from({ length: 100 }, (_, index) =>
        makeTransaction({ id: `t${index}`, deep_link_url: null }),
      ),
    })
    expect(screen.queryByRole('link', { name: 'Open in Up' })).not.toBeInTheDocument()
    expect(screen.getByText(/Showing the newest 100/)).toBeInTheDocument()
  })

  it('clears the gift notice when closed', async () => {
    renderScreen()
    await expand()
    await userEvent.click(screen.getByRole('button', { name: "It's a gift" }))
    const notice = await screen.findByRole('link', { name: 'Open Gifts' })
    const close = within(notice.closest('[role="alert"]') as HTMLElement).getByRole('button')
    await userEvent.click(close)
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Open Gifts' })).not.toBeInTheDocument(),
    )
  })
})
