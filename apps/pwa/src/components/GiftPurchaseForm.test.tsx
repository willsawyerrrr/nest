import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GiftPurchase } from '../hooks/useGifts'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { GiftPurchaseForm } from './GiftPurchaseForm'

const purchase: GiftPurchase = {
  id: 'p1',
  gift_budget_id: 'b1',
  amount_cents: 45_00,
  description: 'Toy train',
  purchased_on: '2026-11-01',
  household_id: 'h',
  created_at: '',
  updated_at: '',
}

function renderForm(overrides: Partial<Parameters<typeof GiftPurchaseForm>[0]> = {}) {
  return render(
    <GiftPurchaseForm budgetId="b1" onSubmit={vi.fn()} onCancel={vi.fn()} {...overrides} />,
  )
}

describe('GiftPurchaseForm', () => {
  it('submits a new purchase with a trimmed description and dollars as cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.type(screen.getByLabelText(/description/i), '  Book  ')
    await user.type(screen.getByLabelText(/amount/i), '30')
    await user.click(screen.getByRole('button', { name: /add purchase/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        gift_budget_id: 'b1',
        amount_cents: 30_00,
        description: 'Book',
        purchased_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
  })

  it('disables submit until an amount is entered', async () => {
    const user = userEvent.setup()
    renderForm()

    const button = screen.getByRole('button', { name: /add purchase/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/amount/i), '15')
    expect(button).toBeEnabled()
  })

  it('prefills fields and keeps the budget when editing', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ initial: purchase, onSubmit })

    expect(screen.getByLabelText(/description/i)).toHaveValue('Toy train')
    expect(screen.getByLabelText(/amount/i)).toHaveValue('$45.00')
    expect(screen.getByLabelText(/purchased on/i)).toHaveValue('1 Nov 2026')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        gift_budget_id: 'b1',
        amount_cents: 45_00,
        description: 'Toy train',
        purchased_on: '2026-11-01',
      }),
    )
  })

  it('shows an error and re-enables the button when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    renderForm({ onSubmit })

    await user.type(screen.getByLabelText(/amount/i), '30')
    await user.click(screen.getByRole('button', { name: /add purchase/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
    expect(screen.getByRole('button', { name: /add purchase/i })).toBeEnabled()
  })

  it('ignores a submit while the form is invalid', () => {
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    const form = screen
      .getByRole('button', { name: /add purchase/i })
      .closest('form') as HTMLElement
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
