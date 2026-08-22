import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GiftPurchase, GiftRecipient } from '../hooks/useGifts'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { GiftPurchaseForm } from './GiftPurchaseForm'

const purchase: GiftPurchase = {
  id: 'p1',
  gift_budget_id: 'b1',
  gift_discretionary_budget_id: null,
  recipient_id: null,
  amount_cents: 45_00,
  description: 'Toy train',
  purchased_on: '2026-11-01',
  transaction_id: null,
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

const gdbPurchase: GiftPurchase = {
  ...purchase,
  id: 'p2',
  gift_budget_id: null,
  gift_discretionary_budget_id: 'gdb1',
  recipient_id: 'r1',
  description: 'Flowers',
}

const alice: GiftRecipient = {
  id: 'r1',
  name: 'Alice',
  member_id: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
const bob: GiftRecipient = { ...alice, id: 'r2', name: 'Bob' }

describe('GiftPurchaseForm ad hoc mode', () => {
  it('omits the recipient picker for a budget-linked purchase', () => {
    renderForm({ budgetId: 'b1' })
    expect(screen.queryByRole('combobox', { name: /recipient/i })).not.toBeInTheDocument()
  })

  it('offers an optional recipient picker for an ad hoc purchase', () => {
    render(
      <GiftPurchaseForm
        discretionaryBudgetId="gdb1"
        recipients={[alice, bob]}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: /recipient/i })).toBeInTheDocument()
  })

  it('submits with the discretionary budget id and no recipient tag by default', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <GiftPurchaseForm discretionaryBudgetId="gdb1" recipients={[alice]} onSubmit={onSubmit} />,
    )

    await user.type(screen.getByLabelText(/amount/i), '20')
    await user.click(screen.getByRole('button', { name: /add purchase/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          gift_budget_id: undefined,
          gift_discretionary_budget_id: 'gdb1',
          recipient_id: null,
          amount_cents: 20_00,
        }),
      ),
    )
  })

  it('submits the tagged recipient when one is chosen', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <GiftPurchaseForm
        discretionaryBudgetId="gdb1"
        recipients={[alice, bob]}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/amount/i), '20')
    await user.click(screen.getByRole('combobox', { name: /recipient/i }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))
    await user.click(screen.getByRole('button', { name: /add purchase/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ recipient_id: 'r2' })),
    )
  })

  it('prefills the tagged recipient when editing an ad hoc purchase', () => {
    render(
      <GiftPurchaseForm
        discretionaryBudgetId="gdb1"
        recipients={[alice, bob]}
        initial={gdbPurchase}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: /recipient/i })).toHaveValue('Alice')
  })

  it('clears an existing recipient tag when set back to untagged', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const { container } = render(
      <GiftPurchaseForm
        discretionaryBudgetId="gdb1"
        recipients={[alice, bob]}
        initial={gdbPurchase}
        onSubmit={onSubmit}
      />,
    )

    // Mantine's clear-button is aria-hidden (a mouse-only affordance), so it is
    // reached by a plain DOM query rather than an accessible role/name.
    const clearButton = container.querySelector('[aria-label="Clear recipient"]') as HTMLElement
    await user.click(clearButton)
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ recipient_id: null })),
    )
  })
})
