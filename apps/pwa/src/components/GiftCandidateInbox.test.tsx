import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DismissedGiftCandidate, GiftCandidate } from '../lib/giftCandidates'
import { render, screen } from '../test/render'
import { GiftCandidateInbox } from './GiftCandidateInbox'

const bookshop: GiftCandidate = {
  transactionId: 't1',
  description: 'Bookshop',
  amountCents: 45_00,
  postedOn: '2026-11-20',
  pending: false,
}
const setAside: DismissedGiftCandidate = {
  ...bookshop,
  transactionId: 't2',
  description: 'Red Cross',
  dismissalId: 'd2',
}
const choices = [
  { value: 'b1', label: 'Alice — Christmas' },
  { value: 'b2', label: 'Bob — Christmas' },
]

function renderInbox(overrides: Partial<Parameters<typeof GiftCandidateInbox>[0]> = {}) {
  return render(
    <GiftCandidateInbox
      candidates={[bookshop]}
      dismissed={[]}
      budgetChoices={choices}
      onLink={vi.fn()}
      onDismiss={vi.fn()}
      onRestore={vi.fn()}
      {...overrides}
    />,
  )
}

describe('GiftCandidateInbox', () => {
  it('lists each candidate with its description, amount, and date', () => {
    renderInbox()

    expect(screen.getByRole('heading', { name: 'From your card' })).toBeInTheDocument()
    expect(screen.getByText('Bookshop')).toBeInTheDocument()
    expect(screen.getByText('$45.00')).toBeInTheDocument()
    expect(screen.getByText('20 Nov 2026')).toBeInTheDocument()
  })

  it('renders nothing when there is neither a candidate nor a set-aside one', () => {
    renderInbox({ candidates: [], dismissed: [] })
    expect(screen.queryByRole('heading', { name: 'From your card' })).not.toBeInTheDocument()
  })

  it('names an undescribed candidate as a card purchase', () => {
    renderInbox({ candidates: [{ ...bookshop, description: '' }] })
    expect(screen.getByText('Card purchase')).toBeInTheDocument()
  })

  it('marks a held transaction as pending and warns its amount can change', () => {
    renderInbox({ candidates: [{ ...bookshop, pending: true }] })

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText(/amount can change when it settles/i)).toBeInTheDocument()
  })

  it('links a candidate to a chosen gift, carrying the transaction and an edited description', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn()
    renderInbox({ onLink })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    await user.click(screen.getByRole('combobox', { name: 'Gift' }))
    await user.click(await screen.findByRole('option', { name: 'Bob — Christmas' }))
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), '  Novel  ')
    await user.click(screen.getByRole('button', { name: 'Link purchase' }))

    expect(onLink).toHaveBeenCalledWith({
      gift_budget_id: 'b2',
      amount_cents: 45_00,
      description: 'Novel',
      purchased_on: '2026-11-20',
      transaction_id: 't1',
    })
  })

  it('prefills the first gift and Up wording, and closes the form on cancel', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn()
    renderInbox({ onLink })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    expect(screen.getByRole('combobox', { name: 'Gift' })).toHaveValue('Alice — Christmas')
    expect(screen.getByLabelText('Description')).toHaveValue('Bookshop')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Link to a gift' })).toBeInTheDocument()
    expect(onLink).not.toHaveBeenCalled()
  })

  it('withholds linking until a gift budget exists', () => {
    renderInbox({ budgetChoices: [] })

    expect(screen.getByRole('button', { name: 'Link to a gift' })).toBeDisabled()
    expect(screen.getByText(/add a gift budget to link these against/i)).toBeInTheDocument()
  })

  it('sets a candidate aside as not a gift', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    renderInbox({ onDismiss })

    await user.click(screen.getByRole('button', { name: 'Not a gift' }))
    expect(onDismiss).toHaveBeenCalledWith('t1')
  })

  it('reveals the set-aside candidates and undoes one', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    renderInbox({ dismissed: [setAside], onRestore })

    // The set-aside list stays collapsed until asked for, so a routine charity
    // donation does not clutter the inbox.
    expect(screen.queryByText('Red Cross')).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Set aside (1)' }))
    expect(screen.getByText('Red Cross')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onRestore).toHaveBeenCalledWith('d2')

    await user.click(screen.getByRole('button', { name: 'Hide set aside' }))
    expect(screen.getByRole('button', { name: 'Set aside (1)' })).toBeInTheDocument()
  })

  it('keeps the section for an undo when every candidate was set aside', () => {
    renderInbox({ candidates: [], dismissed: [setAside] })
    expect(screen.getByRole('button', { name: 'Set aside (1)' })).toBeInTheDocument()
  })

  it('shows an error and keeps the form open when the link fails', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn().mockRejectedValue(new Error('boom'))
    renderInbox({ onLink })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    await user.click(screen.getByRole('button', { name: 'Link purchase' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not link this purchase/i)
  })
})
