import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GiftBudget, GiftOccasion, GiftPurchase, GiftRecipient } from '../hooks/useGifts'
import { makeGiftPurchase, makeGiftTransaction } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { GiftsScreen } from './GiftsScreen'

const alice: GiftRecipient = {
  id: 'r1',
  name: 'Alice',
  member_id: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
const xmas: GiftOccasion = {
  id: 'o1',
  name: 'Christmas',
  occasion_date: '2026-12-25',
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
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

function renderScreen(overrides: Partial<Parameters<typeof GiftsScreen>[0]> = {}) {
  return render(
    <MemoryRouter>
      <GiftsScreen
        recipients={[alice]}
        occasions={[xmas]}
        budgets={[budget]}
        purchases={[]}
        transactions={[]}
        dismissals={[]}
        members={[]}
        currentMemberId={null}
        onCreateRecipient={vi.fn()}
        onUpdateRecipient={vi.fn()}
        onDeleteRecipient={vi.fn()}
        onCreateOccasion={vi.fn()}
        onUpdateOccasion={vi.fn()}
        onDeleteOccasion={vi.fn()}
        onCreateBudget={vi.fn()}
        onUpdateBudget={vi.fn()}
        onDeleteBudget={vi.fn()}
        onCreatePurchase={vi.fn()}
        onUpdatePurchase={vi.fn()}
        onDeletePurchase={vi.fn()}
        onDismissTransaction={vi.fn()}
        onRestoreTransaction={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        refreshError={null}
        {...overrides}
      />
    </MemoryRouter>,
  )
}

describe('GiftsScreen header', () => {
  beforeEach(() => localStorage.clear())

  it('renders as a top-level tab with a title and no back link', () => {
    renderScreen()

    expect(screen.getByRole('heading', { name: 'Gifts' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('GiftsScreen grouping toggle', () => {
  beforeEach(() => localStorage.clear())

  it('groups by occasion by default', () => {
    renderScreen()
    expect(screen.getByRole('heading', { name: 'Christmas' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Alice' })).not.toBeInTheDocument()
  })

  it('regroups by person when the toggle is switched', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(screen.getByRole('radio', { name: 'By person' }))

    expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Christmas' })).not.toBeInTheDocument()
  })
})

describe('GiftsScreen budget date', () => {
  beforeEach(() => localStorage.clear())

  it('shows the effective date, preferring the budget event_date over the occasion date', () => {
    renderScreen({ budgets: [{ ...budget, event_date: '2026-11-15' }] })
    // The row shows its own event_date, not the occasion's 25 Dec date.
    expect(screen.getByText('15 Nov 2026')).toBeInTheDocument()
  })

  it('preselects a saved date when editing an undated occasion and persists it on save', async () => {
    const user = userEvent.setup()
    const onUpdateBudget = vi.fn()
    const bday: GiftOccasion = { ...xmas, id: 'o2', name: 'Birthday', occasion_date: null }
    renderScreen({
      occasions: [bday],
      budgets: [{ ...budget, occasion_id: 'o2', event_date: '2026-11-15' }],
      onUpdateBudget,
    })

    // Groups default collapsed, so expand the occasion group before its rows show.
    await user.click(screen.getByRole('button', { name: /Birthday/ }))
    await user.click(screen.getByRole('button', { name: /Alice/ }))
    await user.click(screen.getByRole('button', { name: 'Edit budget' }))

    expect(screen.getByLabelText('Date')).toHaveValue('15 Nov 2026')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onUpdateBudget).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ event_date: '2026-11-15' }),
    )
  })

  it('hides the per-gift date and clears any override when editing a dated occasion', async () => {
    const user = userEvent.setup()
    const onUpdateBudget = vi.fn()
    renderScreen({ budgets: [{ ...budget, event_date: '2026-11-15' }], onUpdateBudget })

    // Groups default collapsed, so expand the occasion group before its rows show.
    await user.click(screen.getByRole('button', { name: /Christmas/ }))
    await user.click(screen.getByRole('button', { name: /Alice/ }))
    await user.click(screen.getByRole('button', { name: 'Edit budget' }))

    // Christmas is dated, so its date governs — no per-gift date field is shown.
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onUpdateBudget).toHaveBeenCalledWith('b1', expect.objectContaining({ event_date: null }))
  })
})

describe('GiftsScreen total', () => {
  beforeEach(() => localStorage.clear())

  it('shows an overall total rollup card', () => {
    const purchase: GiftPurchase = {
      id: 'p1',
      gift_budget_id: 'b1',
      amount_cents: 30_00,
      description: 'Book',
      purchased_on: '2026-11-01',
      transaction_id: null,
      household_id: 'h',
      created_at: '',
      updated_at: '',
    }
    renderScreen({ purchases: [purchase] })

    const total = screen
      .getByRole('heading', { name: 'Total' })
      .closest('.mantine-Card-root') as HTMLElement
    expect(within(total).getByText('Budget $100.00')).toBeInTheDocument()
    expect(within(total).getByText('Spent $30.00')).toBeInTheDocument()
    expect(within(total).getByText('Left $70.00')).toBeInTheDocument()
  })

  it('omits the total when there are no budgets', () => {
    renderScreen({ budgets: [] })
    expect(screen.queryByRole('heading', { name: 'Total' })).not.toBeInTheDocument()
  })
})

describe('GiftsScreen spend rollup', () => {
  beforeEach(() => localStorage.clear())

  it('shows the full budget as remaining with no purchases', () => {
    renderScreen()
    expect(screen.getAllByText('Left $100.00').length).toBeGreaterThan(0)
  })

  it('reduces remaining by a recorded purchase', () => {
    const purchase: GiftPurchase = {
      id: 'p1',
      gift_budget_id: 'b1',
      amount_cents: 30_00,
      description: 'Book',
      purchased_on: '2026-11-01',
      transaction_id: null,
      household_id: 'h',
      created_at: '',
      updated_at: '',
    }
    renderScreen({ purchases: [purchase] })

    expect(screen.getAllByText('Left $70.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('Left $100.00')).not.toBeInTheDocument()
  })

  it('reports zero remaining budget as fully spent when over budget', () => {
    const purchase: GiftPurchase = {
      id: 'p1',
      gift_budget_id: 'b1',
      amount_cents: 20_00,
      description: 'Book',
      purchased_on: '2026-11-01',
      transaction_id: null,
      household_id: 'h',
      created_at: '',
      updated_at: '',
    }
    renderScreen({ budgets: [{ ...budget, budgeted_amount_cents: 0 }], purchases: [purchase] })

    expect(screen.getAllByText('Left -$20.00').length).toBeGreaterThan(0)
  })
})

const bob: GiftRecipient = { ...alice, id: 'r2', name: 'Bob' }

describe('GiftsScreen manage toggle', () => {
  beforeEach(() => localStorage.clear())

  it('reveals recipient/occasion management and flips the button label', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    expect(screen.getByRole('heading', { name: 'Recipients' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument()
  })
})

describe('GiftsScreen empty prompts', () => {
  beforeEach(() => localStorage.clear())

  it('prompts to add both a recipient and an occasion when neither exists', () => {
    renderScreen({ recipients: [], occasions: [], budgets: [] })
    expect(screen.getByText(/add a recipient and an occasion/i)).toBeInTheDocument()
  })

  it('prompts to add an occasion when only recipients exist', () => {
    renderScreen({ recipients: [alice], occasions: [], budgets: [] })
    expect(screen.getByText(/no occasions yet\. tap/i)).toBeInTheDocument()
  })

  it('prompts to add a recipient when grouping by person with none', async () => {
    const user = userEvent.setup()
    renderScreen({ recipients: [], occasions: [xmas], budgets: [] })

    await user.click(screen.getByRole('radio', { name: 'By person' }))
    expect(screen.getByText(/no recipients yet\. tap/i)).toBeInTheDocument()
  })
})

describe('GiftsScreen group budgets', () => {
  beforeEach(() => localStorage.clear())

  it('shows an empty note for a group with no budgets', async () => {
    const user = userEvent.setup()
    const birthday: GiftOccasion = { ...xmas, id: 'o2', name: 'Birthday', occasion_date: null }
    renderScreen({ occasions: [xmas, birthday] })

    await user.click(screen.getByRole('button', { name: /Birthday/ }))
    expect(screen.getByText('No gift budgets yet.')).toBeInTheDocument()
  })

  it('adds a gift budget to a group, locking the occasion', async () => {
    const user = userEvent.setup()
    const onCreateBudget = vi.fn()
    renderScreen({ recipients: [alice, bob], onCreateBudget })

    await user.click(screen.getByRole('button', { name: /Christmas/ }))
    await user.click(screen.getByRole('button', { name: 'Add gift budget' }))

    // The occasion is locked to the group, so only the recipient can be chosen.
    expect(screen.queryByRole('combobox', { name: /occasion/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: /recipient/i }))
    await user.click(await screen.findByRole('option', { name: 'Bob' }))
    await user.type(screen.getByLabelText(/budget/i), '40')
    await user.click(screen.getByRole('button', { name: 'Add budget' }))

    expect(onCreateBudget).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_id: 'r2', occasion_id: 'o1' }),
    )
  })

  it('cancels adding a gift budget', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(screen.getByRole('button', { name: /Christmas/ }))
    await user.click(screen.getByRole('button', { name: 'Add gift budget' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Add gift budget' })).toBeInTheDocument()
  })
})

async function expandRow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Christmas/ }))
  await user.click(screen.getByRole('button', { name: /Alice/ }))
}

describe('GiftsScreen private gifts for the current member', () => {
  beforeEach(() => localStorage.clear())

  const meRecipient: GiftRecipient = { ...alice, id: 'r9', name: 'Me', member_id: 'me' }
  const myGift: GiftBudget = { ...budget, id: 'b9', recipient_id: 'r9' }
  const myPurchase: GiftPurchase = {
    id: 'p9',
    gift_budget_id: 'b9',
    amount_cents: 40_00,
    description: 'Secret',
    purchased_on: '2026-12-02',
    transaction_id: null,
    household_id: 'h',
    created_at: '',
    updated_at: '',
  }

  it('hides spend and the purchase log for a gift whose recipient is the current member', async () => {
    const user = userEvent.setup()
    renderScreen({
      recipients: [meRecipient],
      budgets: [myGift],
      purchases: [myPurchase],
      currentMemberId: 'me',
    })

    await user.click(screen.getByRole('button', { name: /Christmas/ }))

    // The gift shows only its agreed budget plus a note, with no expandable
    // purchase log, add-purchase control, or "Secret" purchase.
    expect(screen.getByText(/spending on this gift is hidden from you/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Me/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add purchase' })).not.toBeInTheDocument()
    expect(screen.queryByText('Secret')).not.toBeInTheDocument()
  })

  it('lets the current member edit the agreed budget for their own gift', async () => {
    const user = userEvent.setup()
    const onUpdateBudget = vi.fn()
    renderScreen({
      recipients: [meRecipient],
      budgets: [myGift],
      purchases: [myPurchase],
      currentMemberId: 'me',
      onUpdateBudget,
    })

    await user.click(screen.getByRole('button', { name: /Christmas/ }))
    await user.click(screen.getByRole('button', { name: 'Edit budget' }))

    // The edit form opens for the own-gift, yet its spend and purchases stay hidden.
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onUpdateBudget).toHaveBeenCalledWith(
      'b9',
      expect.objectContaining({ recipient_id: 'r9' }),
    )
    expect(screen.queryByText('Secret')).not.toBeInTheDocument()
  })

  it('shows spend and purchases for a gift whose recipient is not the current member', async () => {
    const user = userEvent.setup()
    renderScreen({
      recipients: [meRecipient],
      budgets: [myGift],
      purchases: [myPurchase],
      currentMemberId: 'someone-else',
    })

    await user.click(screen.getByRole('button', { name: /Christmas/ }))
    await user.click(screen.getByRole('button', { name: /^Me/ }))

    expect(screen.queryByText(/spending on this gift is hidden from you/i)).not.toBeInTheDocument()
    expect(screen.getByText('Secret')).toBeInTheDocument()
  })

  it('shows only the budgeted amount, hiding spend and the progress bar, for a fully-yours group and total', async () => {
    const user = userEvent.setup()
    renderScreen({
      recipients: [meRecipient],
      budgets: [myGift],
      purchases: [myPurchase],
      currentMemberId: 'me',
    })

    await user.click(screen.getByRole('radio', { name: 'By person' }))

    // Both the "Me" group and the overall total show the budgeted amount alone.
    expect(screen.getAllByText('Budget $100.00').length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Spent /)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Left /)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Me spend')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Total gift spend')).not.toBeInTheDocument()
  })

  it('keeps spend and the progress bar for a mixed group that also has gifts for others', () => {
    renderScreen({
      recipients: [meRecipient, alice],
      budgets: [myGift, budget],
      purchases: [myPurchase],
      currentMemberId: 'me',
    })

    // Christmas holds both my gift and Alice's, so the group and total keep their
    // spend rollup and progress bar.
    expect(screen.getByLabelText('Christmas spend')).toBeInTheDocument()
    expect(screen.getByLabelText('Total gift spend')).toBeInTheDocument()
    expect(screen.getAllByText(/^Spent /).length).toBeGreaterThan(0)
  })
})

describe('GiftsScreen purchases', () => {
  beforeEach(() => localStorage.clear())

  it('shows an empty note and adds a purchase', async () => {
    const user = userEvent.setup()
    const onCreatePurchase = vi.fn()
    renderScreen({ onCreatePurchase })

    await expandRow(user)
    expect(screen.getByText('No purchases yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add purchase' }))
    await user.type(screen.getByLabelText(/amount/i), '25')
    await user.click(screen.getByRole('button', { name: 'Add purchase' }))

    expect(onCreatePurchase).toHaveBeenCalledWith(
      expect.objectContaining({ gift_budget_id: 'b1', amount_cents: 25_00 }),
    )
  })

  it('cancels adding a purchase', async () => {
    const user = userEvent.setup()
    renderScreen()

    await expandRow(user)
    await user.click(screen.getByRole('button', { name: 'Add purchase' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Add purchase' })).toBeInTheDocument()
  })

  it('cancels editing a purchase', async () => {
    const user = userEvent.setup()
    const purchase: GiftPurchase = {
      id: 'p1',
      gift_budget_id: 'b1',
      amount_cents: 30_00,
      description: 'Book',
      purchased_on: '2026-11-01',
      transaction_id: null,
      household_id: 'h',
      created_at: '',
      updated_at: '',
    }
    renderScreen({ purchases: [purchase] })

    await expandRow(user)
    await user.click(screen.getByRole('button', { name: 'Edit Book' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Edit Book' })).toBeInTheDocument()
  })

  it('cancels editing a budget from a row', async () => {
    const user = userEvent.setup()
    renderScreen()

    await expandRow(user)
    await user.click(screen.getByRole('button', { name: 'Edit budget' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Add purchase' })).toBeInTheDocument()
  })

  it('confirms before deleting a budget', async () => {
    const user = userEvent.setup()
    const onDeleteBudget = vi.fn()
    renderScreen({ onDeleteBudget })

    await expandRow(user)
    await user.click(screen.getByRole('button', { name: 'Delete budget' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(onDeleteBudget).toHaveBeenCalledWith('b1')
  })

  it('edits and deletes an existing purchase', async () => {
    const user = userEvent.setup()
    const onUpdatePurchase = vi.fn()
    const onDeletePurchase = vi.fn()
    const purchase: GiftPurchase = {
      id: 'p1',
      gift_budget_id: 'b1',
      amount_cents: 30_00,
      description: 'Book',
      purchased_on: '2026-11-01',
      transaction_id: null,
      household_id: 'h',
      created_at: '',
      updated_at: '',
    }
    renderScreen({ purchases: [purchase], onUpdatePurchase, onDeletePurchase })

    await expandRow(user)
    await user.click(screen.getByRole('button', { name: 'Edit Book' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onUpdatePurchase).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ gift_budget_id: 'b1', amount_cents: 30_00, description: 'Book' }),
    )

    await user.click(screen.getByRole('button', { name: 'Delete Book' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(onDeletePurchase).toHaveBeenCalledWith('p1')
  })

  it('labels an undescribed purchase as a generic purchase', async () => {
    const user = userEvent.setup()
    const purchase: GiftPurchase = {
      id: 'p1',
      gift_budget_id: 'b1',
      amount_cents: 30_00,
      description: '',
      purchased_on: '2026-11-01',
      transaction_id: null,
      household_id: 'h',
      created_at: '',
      updated_at: '',
    }
    renderScreen({ purchases: [purchase] })

    await expandRow(user)
    expect(screen.getByRole('button', { name: 'Edit purchase' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete purchase' })).toBeInTheDocument()
  })
})

describe('GiftsScreen card-spending inbox', () => {
  beforeEach(() => localStorage.clear())

  const bookshop = makeGiftTransaction({ id: 't1', description: 'Bookshop' })

  it('offers the synced card spending as a candidate to link', () => {
    renderScreen({ transactions: [bookshop] })

    expect(screen.getByRole('heading', { name: 'From your card' })).toBeInTheDocument()
    expect(screen.getByText('Bookshop')).toBeInTheDocument()
  })

  it('omits the inbox entirely when nothing is synced', () => {
    renderScreen()
    expect(screen.queryByRole('heading', { name: 'From your card' })).not.toBeInTheDocument()
  })

  it('keeps a gift for the signed-in member out of the link picker', async () => {
    const user = userEvent.setup()
    const meRecipient: GiftRecipient = { ...alice, id: 'r9', name: 'Me', member_id: 'me' }
    const myGift: GiftBudget = { ...budget, id: 'b9', recipient_id: 'r9' }
    renderScreen({
      recipients: [alice, meRecipient],
      budgets: [budget, myGift],
      transactions: [bookshop],
      currentMemberId: 'me',
    })

    await user.click(screen.getByRole('button', { name: 'Link to a gift' }))
    await user.click(screen.getByRole('combobox', { name: 'Recipient' }))

    // Their own gift's spend is hidden from them and RLS blocks the insert, so
    // neither it nor — their every gift being hidden — they are offered at all.
    expect(await screen.findByRole('option', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Me' })).not.toBeInTheDocument()
  })

  it('marks a purchase that came from a card transaction', async () => {
    const user = userEvent.setup()
    renderScreen({
      purchases: [makeGiftPurchase({ description: 'Novel', transaction_id: 't1' })],
    })

    await expandRow(user)
    expect(screen.getByText('From Up')).toBeInTheDocument()
  })

  it('leaves a hand-entered purchase unmarked', async () => {
    const user = userEvent.setup()
    renderScreen({ purchases: [makeGiftPurchase({ description: 'Novel' })] })

    await expandRow(user)
    expect(screen.queryByText('From Up')).not.toBeInTheDocument()
  })

  it('pulls fresh transactions from Up and reports a failed refresh', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    renderScreen({ onRefresh })

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onRefresh).toHaveBeenCalledOnce()

    renderScreen({ refreshError: 'Could not refresh from Up. Try again.' })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not refresh from up/i)
  })
})
