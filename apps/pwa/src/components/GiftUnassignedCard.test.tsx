import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GiftBudget, GiftOccasion, GiftRecipient } from '../hooks/useGifts'
import { makeGiftDiscretionaryBudget, makeGiftPurchase } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { GiftUnassignedCard } from './GiftUnassignedCard'

const alice: GiftRecipient = {
  id: 'r1',
  name: 'Alice',
  member_id: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
const bob: GiftRecipient = { ...alice, id: 'r2', name: 'Bob' }
const birthday: GiftOccasion = {
  id: 'o1',
  name: 'Birthday',
  occasion_date: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
const bobsBudget: GiftBudget = {
  id: 'b1',
  recipient_id: 'r2',
  occasion_id: 'o1',
  budgeted_amount_cents: 100_00,
  event_date: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}

function renderCard(overrides: Partial<Parameters<typeof GiftUnassignedCard>[0]> = {}) {
  return render(
    <GiftUnassignedCard
      purchases={[]}
      budgets={[]}
      occasions={[]}
      recipients={[alice, bob]}
      discretionaryBudget={null}
      hiddenBudgetIds={new Set()}
      onCreatePurchase={vi.fn()}
      onUpdatePurchase={vi.fn()}
      onDeletePurchase={vi.fn()}
      {...overrides}
    />,
  )
}

/** Opens the card's collapsible body. */
async function expandCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /unassigned purchases/i }))
}

describe('GiftUnassignedCard', () => {
  it('always renders, even with nothing logged', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: 'Unassigned purchases' })).toBeInTheDocument()
    expect(screen.getByText('Logged so far $0.00')).toBeInTheDocument()
  })

  it('reports only unassigned purchases in the running total, ignoring budget-linked and ad hoc ones', async () => {
    renderCard({
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: null,
          amount_cents: 12_00,
        }),
        makeGiftPurchase({ id: 'p2', gift_budget_id: 'b1', amount_cents: 999_00 }),
        makeGiftPurchase({
          id: 'p3',
          gift_budget_id: null,
          gift_discretionary_budget_id: 'gdb1',
          amount_cents: 500_00,
        }),
      ],
    })

    expect(screen.getByText('Logged so far $12.00')).toBeInTheDocument()
  })

  it('shows an empty note with no unassigned purchases', async () => {
    const user = userEvent.setup()
    renderCard()

    await expandCard(user)
    expect(screen.getByText('No unassigned purchases.')).toBeInTheDocument()
  })

  it('adds an unassigned purchase with no budget or buffer set', async () => {
    const user = userEvent.setup()
    const onCreatePurchase = vi.fn()
    renderCard({ onCreatePurchase })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Add purchase' }))
    await user.type(screen.getByLabelText(/description/i), 'Wrapping paper')
    await user.type(screen.getByLabelText(/amount/i), '12')
    await user.click(screen.getByRole('button', { name: 'Add purchase' }))

    expect(onCreatePurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        gift_budget_id: undefined,
        gift_discretionary_budget_id: undefined,
        amount_cents: 12_00,
        description: 'Wrapping paper',
      }),
    )
    // No recipient tag is offered for an unassigned purchase.
    expect(screen.queryByLabelText(/recipient/i)).not.toBeInTheDocument()
  })

  it('cancels adding a purchase without saving', async () => {
    const user = userEvent.setup()
    const onCreatePurchase = vi.fn()
    renderCard({ onCreatePurchase })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Add purchase' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCreatePurchase).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add purchase' })).toBeInTheDocument()
  })

  it('edits an existing unassigned purchase', async () => {
    const user = userEvent.setup()
    const onUpdatePurchase = vi.fn()
    renderCard({
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: null,
          description: 'Wrapping paper',
          amount_cents: 12_00,
        }),
      ],
      onUpdatePurchase,
    })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Edit Wrapping paper' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onUpdatePurchase).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ amount_cents: 12_00, description: 'Wrapping paper' }),
    )
  })

  it('deletes an unassigned purchase after confirming', async () => {
    const user = userEvent.setup()
    const onDeletePurchase = vi.fn()
    renderCard({
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: null,
          description: 'Wrapping paper',
        }),
      ],
      onDeletePurchase,
    })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Delete Wrapping paper' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(onDeletePurchase).toHaveBeenCalledWith('p1')
  })

  it('assigns an unassigned purchase to a specific gift', async () => {
    const user = userEvent.setup()
    const onUpdatePurchase = vi.fn()
    renderCard({
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: null,
          description: 'Wrapping paper',
          amount_cents: 12_00,
          purchased_on: '2026-08-01',
        }),
      ],
      budgets: [bobsBudget],
      occasions: [birthday],
      onUpdatePurchase,
    })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Assign Wrapping paper' }))
    // Defaults to "A specific gift" once a gift budget exists.
    await user.click(screen.getByRole('combobox', { name: /recipient/i }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))
    await user.click(screen.getByRole('combobox', { name: /occasion/i }))
    await user.click(await screen.findByRole('option', { name: 'Birthday' }))
    await user.click(screen.getByRole('button', { name: 'Assign' }))

    expect(onUpdatePurchase).toHaveBeenCalledWith('p1', {
      gift_budget_id: 'b1',
      amount_cents: 12_00,
      description: 'Wrapping paper',
      purchased_on: '2026-08-01',
    })
  })

  it('assigns an unassigned purchase to the ad hoc buffer, optionally tagged to a recipient', async () => {
    const user = userEvent.setup()
    const onUpdatePurchase = vi.fn()
    renderCard({
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: null,
          description: 'Wrapping paper',
          amount_cents: 12_00,
          purchased_on: '2026-08-01',
        }),
      ],
      discretionaryBudget: makeGiftDiscretionaryBudget({ id: 'gdb1' }),
      onUpdatePurchase,
    })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Assign Wrapping paper' }))
    await user.click(screen.getByRole('radio', { name: 'Ad hoc gifts' }))
    await user.click(screen.getByRole('combobox', { name: /recipient/i }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))
    await user.click(screen.getByRole('button', { name: 'Assign' }))

    expect(onUpdatePurchase).toHaveBeenCalledWith('p1', {
      gift_discretionary_budget_id: 'gdb1',
      recipient_id: 'r2',
      amount_cents: 12_00,
      description: 'Wrapping paper',
      purchased_on: '2026-08-01',
    })
  })

  it('disables assigning to the ad hoc buffer before it exists', async () => {
    const user = userEvent.setup()
    renderCard({
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: null,
          description: 'Wrapping paper',
        }),
      ],
    })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Assign Wrapping paper' }))
    await user.click(screen.getByRole('radio', { name: 'Ad hoc gifts' }))

    expect(screen.getByText(/set the ad hoc gifts budget/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
  })

  it('cancels assigning a purchase without saving', async () => {
    const user = userEvent.setup()
    const onUpdatePurchase = vi.fn()
    renderCard({
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: null,
          description: 'Wrapping paper',
        }),
      ],
      budgets: [bobsBudget],
      occasions: [birthday],
      onUpdatePurchase,
    })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Assign Wrapping paper' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onUpdatePurchase).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Assign Wrapping paper' })).toBeInTheDocument()
  })
})
