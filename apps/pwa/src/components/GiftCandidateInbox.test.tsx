import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  DismissedGiftCandidate,
  GiftCandidate,
  GiftLinkRecipient,
} from '../lib/giftCandidates'
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
const alice: GiftLinkRecipient = {
  value: 'r1',
  label: 'Alice',
  occasions: [
    { value: 'b1', label: 'Birthday' },
    { value: 'b2', label: 'Christmas' },
  ],
}
const bob: GiftLinkRecipient = {
  value: 'r2',
  label: 'Bob',
  occasions: [{ value: 'b3', label: 'Christmas' }],
}
const choices = [alice, bob]

function renderInbox(overrides: Partial<Parameters<typeof GiftCandidateInbox>[0]> = {}) {
  return render(
    <GiftCandidateInbox
      candidates={[bookshop]}
      dismissed={[]}
      recipientChoices={choices}
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

  it('links a candidate to a chosen recipient and occasion, carrying the transaction and an edited description', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn()
    renderInbox({ onLink })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    await user.click(screen.getByRole('combobox', { name: 'Recipient' }))
    await user.click(await screen.findByRole('option', { name: 'Alice' }))
    await user.click(screen.getByRole('combobox', { name: 'Occasion' }))
    await user.click(await screen.findByRole('option', { name: 'Christmas' }))
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

  it('holds the occasion inert, and the purchase back, until a recipient is chosen', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn()
    renderInbox({ onLink })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))

    const occasion = screen.getByRole('combobox', { name: 'Occasion' })
    expect(occasion).toBeDisabled()
    expect(occasion).toHaveAttribute('placeholder', 'Choose a recipient first')
    expect(screen.getByRole('button', { name: 'Link purchase' })).toBeDisabled()

    await user.click(screen.getByRole('combobox', { name: 'Recipient' }))
    await user.click(await screen.findByRole('option', { name: 'Alice' }))
    expect(screen.getByRole('combobox', { name: 'Occasion' })).toBeEnabled()
  })

  it("starts on a recipient's only occasion, so one gift per person is a single choice", async () => {
    const user = userEvent.setup()
    const onLink = vi.fn()
    renderInbox({ onLink })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    await user.click(screen.getByRole('combobox', { name: 'Recipient' }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))

    expect(screen.getByRole('combobox', { name: 'Occasion' })).toHaveValue('Christmas')
    await user.click(screen.getByRole('button', { name: 'Link purchase' }))
    expect(onLink).toHaveBeenCalledWith(expect.objectContaining({ gift_budget_id: 'b3' }))
  })

  it('starts on the only recipient there is, with their only occasion', async () => {
    const user = userEvent.setup()
    renderInbox({ recipientChoices: [bob] })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    expect(screen.getByRole('combobox', { name: 'Recipient' })).toHaveValue('Bob')
    expect(screen.getByRole('combobox', { name: 'Occasion' })).toHaveValue('Christmas')
  })

  it('starts the occasion afresh when the recipient changes', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn()
    renderInbox({ onLink })

    // Bob's sole occasion is chosen for him, then Alice — who has two — is
    // picked instead, so no occasion of Bob's can be submitted against her.
    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    await user.click(screen.getByRole('combobox', { name: 'Recipient' }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))
    await user.click(screen.getByRole('combobox', { name: 'Recipient' }))
    await user.click(await screen.findByRole('option', { name: 'Alice' }))

    expect(screen.getByRole('combobox', { name: 'Occasion' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Link purchase' })).toBeDisabled()
  })

  it('prefills Up wording, and closes the form on cancel', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn()
    renderInbox({ onLink })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    expect(screen.getByLabelText('Description')).toHaveValue('Bookshop')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Link to a gift' })).toBeInTheDocument()
    expect(onLink).not.toHaveBeenCalled()
  })

  it('withholds linking until a gift budget exists', () => {
    renderInbox({ recipientChoices: [] })

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
    renderInbox({ onLink, recipientChoices: [bob] })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    await user.click(screen.getByRole('button', { name: 'Link purchase' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not link this purchase/i)
  })
})
