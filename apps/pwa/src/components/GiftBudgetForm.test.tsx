import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GiftBudget, GiftOccasion, GiftRecipient } from '../hooks/useGifts'
import { pairKey } from '../lib/gifts'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { GiftBudgetForm } from './GiftBudgetForm'

const alice: GiftRecipient = {
  id: 'r1',
  name: 'Alice',
  member_id: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
const bob: GiftRecipient = { ...alice, id: 'r2', name: 'Bob' }
const xmas: GiftOccasion = {
  id: 'o1',
  name: 'Christmas',
  occasion_date: '2026-12-25',
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
const bday: GiftOccasion = { ...xmas, id: 'o2', name: 'Birthday', occasion_date: null }
const budget: GiftBudget = {
  id: 'b1',
  recipient_id: 'r1',
  occasion_id: 'o1',
  budgeted_amount_cents: 100_00,
  event_date: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}

function renderForm(overrides: Partial<Parameters<typeof GiftBudgetForm>[0]> = {}) {
  return render(
    <GiftBudgetForm
      recipients={[alice, bob]}
      occasions={[xmas, bday]}
      takenPairs={new Set()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />,
  )
}

describe('GiftBudgetForm', () => {
  it('submits a new budget with the chosen pairing and dollars as cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.click(screen.getByRole('combobox', { name: /recipient/i }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))
    await user.click(screen.getByRole('combobox', { name: /occasion/i }))
    await user.click(await screen.findByRole('option', { name: 'Birthday' }))
    await user.type(screen.getByLabelText(/budget/i), '50')
    await user.click(screen.getByRole('button', { name: /add budget/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        recipient_id: 'r2',
        occasion_id: 'o2',
        budgeted_amount_cents: 50_00,
        event_date: null,
      }),
    )
  })

  it('disables submit until an amount is entered', async () => {
    const user = userEvent.setup()
    renderForm()

    const button = screen.getByRole('button', { name: /add budget/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/budget/i), '25')
    expect(button).toBeEnabled()
  })

  it('blocks a duplicate recipient/occasion pairing', async () => {
    const user = userEvent.setup()
    renderForm({ takenPairs: new Set([pairKey('r1', 'o1')]) })

    await user.type(screen.getByLabelText(/budget/i), '25')

    expect(
      screen.getByText('A budget already exists for this recipient and occasion.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add budget/i })).toBeDisabled()
  })

  it('hides the selectors and keeps the pairing when editing', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ initial: budget, onSubmit })

    expect(screen.queryByRole('combobox', { name: /recipient/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /occasion/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/budget/i)).toHaveValue('$100.00')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        recipient_id: 'r1',
        occasion_id: 'o1',
        budgeted_amount_cents: 100_00,
        event_date: null,
      }),
    )
  })

  it('hides the recipient selector when the recipient is locked', () => {
    renderForm({ lockedRecipientId: 'r1' })

    expect(screen.queryByRole('combobox', { name: /recipient/i })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /occasion/i })).toBeInTheDocument()
  })

  it('hides the occasion selector when the occasion is locked', () => {
    renderForm({ lockedOccasionId: 'o1' })

    expect(screen.queryByRole('combobox', { name: /occasion/i })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /recipient/i })).toBeInTheDocument()
  })

  it('shows an error and re-enables the button when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    renderForm({ onSubmit })

    await user.type(screen.getByLabelText(/budget/i), '50')
    await user.click(screen.getByRole('button', { name: /add budget/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
    expect(screen.getByRole('button', { name: /add budget/i })).toBeEnabled()
  })

  it('ignores a submit while the form is invalid', async () => {
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    const form = screen.getByRole('button', { name: /add budget/i }).closest('form') as HTMLElement
    fireEvent.submit(form)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels when a cancel handler is provided', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderForm({ onCancel })

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('omits the cancel button when no cancel handler is given', () => {
    renderForm({ onCancel: undefined })
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
  })
})
