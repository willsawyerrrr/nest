import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GiftRecipient } from '../hooks/useGifts'
import { makeGiftDiscretionaryBudget, makeGiftPurchase } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { GiftDiscretionaryCard } from './GiftDiscretionaryCard'

const alice: GiftRecipient = {
  id: 'r1',
  name: 'Alice',
  member_id: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
const bob: GiftRecipient = { ...alice, id: 'r2', name: 'Bob' }

function renderCard(overrides: Partial<Parameters<typeof GiftDiscretionaryCard>[0]> = {}) {
  return render(
    <GiftDiscretionaryCard
      discretionaryBudget={null}
      purchases={[]}
      recipients={[alice, bob]}
      onUpsertBudget={vi.fn()}
      onCreatePurchase={vi.fn()}
      onUpdatePurchase={vi.fn()}
      onDeletePurchase={vi.fn()}
      {...overrides}
    />,
  )
}

/** Opens the card's collapsible body. */
async function expandCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /ad hoc gifts/i }))
}

describe('GiftDiscretionaryCard', () => {
  it('always renders, even with no budget set', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: 'Ad hoc gifts' })).toBeInTheDocument()
  })

  it('shows the budgeted amount alone with no purchases', async () => {
    const user = userEvent.setup()
    renderCard({
      discretionaryBudget: makeGiftDiscretionaryBudget({ budgeted_amount_cents: 80_00 }),
    })

    await expandCard(user)
    expect(screen.getAllByText('Budget $80.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Spent $0.00').length).toBeGreaterThan(0)
  })

  it('rolls up spend from only the ad hoc purchases, ignoring budget-linked ones', async () => {
    const user = userEvent.setup()
    renderCard({
      discretionaryBudget: makeGiftDiscretionaryBudget({ budgeted_amount_cents: 100_00 }),
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: 'gdb1',
          amount_cents: 30_00,
        }),
        makeGiftPurchase({ id: 'p2', gift_budget_id: 'b1', amount_cents: 999_00 }),
      ],
    })

    await expandCard(user)
    expect(screen.getAllByText('Spent $30.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Left $70.00').length).toBeGreaterThan(0)
  })

  it('disables adding a purchase, with a hint, before the buffer row exists', async () => {
    const user = userEvent.setup()
    renderCard()

    await expandCard(user)
    expect(screen.getByRole('button', { name: 'Add purchase' })).toBeDisabled()
    expect(screen.getByText(/set a budget above/i)).toBeInTheDocument()
  })

  it('upserts the budgeted amount from the inline editor', async () => {
    const user = userEvent.setup()
    const onUpsertBudget = vi.fn()
    renderCard({ onUpsertBudget })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Edit budget' }))
    const amountInput = screen.getByLabelText(/budgeted amount/i)
    await user.clear(amountInput)
    await user.type(amountInput, '60')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onUpsertBudget).toHaveBeenCalledWith({ budgeted_amount_cents: 60_00 })
  })

  it('cancels editing the budgeted amount without saving', async () => {
    const user = userEvent.setup()
    const onUpsertBudget = vi.fn()
    renderCard({ onUpsertBudget })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Edit budget' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onUpsertBudget).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit budget' })).toBeInTheDocument()
  })

  it('adds an ad hoc purchase, optionally tagged to a recipient', async () => {
    const user = userEvent.setup()
    const onCreatePurchase = vi.fn()
    renderCard({
      discretionaryBudget: makeGiftDiscretionaryBudget({ id: 'gdb1' }),
      onCreatePurchase,
    })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Add purchase' }))
    await user.type(screen.getByLabelText(/description/i), 'Flowers')
    await user.type(screen.getByLabelText(/amount/i), '20')
    await user.click(screen.getByRole('combobox', { name: /recipient/i }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))
    await user.click(screen.getByRole('button', { name: 'Add purchase' }))

    expect(onCreatePurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        gift_discretionary_budget_id: 'gdb1',
        recipient_id: 'r2',
        amount_cents: 20_00,
        description: 'Flowers',
      }),
    )
  })

  it('shows a tagged purchase with its recipient badge, and an untagged one without', async () => {
    const user = userEvent.setup()
    renderCard({
      discretionaryBudget: makeGiftDiscretionaryBudget({ id: 'gdb1' }),
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: 'gdb1',
          recipient_id: 'r1',
          description: 'Flowers',
        }),
        makeGiftPurchase({
          id: 'p2',
          gift_budget_id: null,
          gift_discretionary_budget_id: 'gdb1',
          description: 'Chocolates',
        }),
      ],
    })

    await expandCard(user)
    expect(screen.getByText('For Alice')).toBeInTheDocument()
    expect(screen.getByText('Chocolates')).toBeInTheDocument()
    // Exactly one recipient badge — the untagged purchase gets none.
    expect(screen.getAllByText(/^For /)).toHaveLength(1)
  })

  it('edits an existing ad hoc purchase', async () => {
    const user = userEvent.setup()
    const onUpdatePurchase = vi.fn()
    renderCard({
      discretionaryBudget: makeGiftDiscretionaryBudget({ id: 'gdb1' }),
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: 'gdb1',
          description: 'Flowers',
          amount_cents: 20_00,
        }),
      ],
      onUpdatePurchase,
    })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Edit Flowers' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onUpdatePurchase).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ gift_discretionary_budget_id: 'gdb1', amount_cents: 20_00 }),
    )
  })

  it('deletes an ad hoc purchase after confirming', async () => {
    const user = userEvent.setup()
    const onDeletePurchase = vi.fn()
    renderCard({
      discretionaryBudget: makeGiftDiscretionaryBudget({ id: 'gdb1' }),
      purchases: [
        makeGiftPurchase({
          id: 'p1',
          gift_budget_id: null,
          gift_discretionary_budget_id: 'gdb1',
          description: 'Flowers',
        }),
      ],
      onDeletePurchase,
    })

    await expandCard(user)
    await user.click(screen.getByRole('button', { name: 'Delete Flowers' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(onDeletePurchase).toHaveBeenCalledWith('p1')
  })

  it('shows an empty note with no ad hoc purchases yet', async () => {
    const user = userEvent.setup()
    renderCard({ discretionaryBudget: makeGiftDiscretionaryBudget() })

    await expandCard(user)
    expect(screen.getByText('No ad hoc purchases yet.')).toBeInTheDocument()
  })
})
