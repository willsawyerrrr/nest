import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeBudgetLine, makeMemberAllowance, makeTemporaryItem } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { BudgetScreen } from './BudgetScreen'

function renderScreen(overrides: Partial<Parameters<typeof BudgetScreen>[0]> = {}) {
  const props: Parameters<typeof BudgetScreen>[0] = {
    lines: [makeBudgetLine({ id: 'l1', line_group: 'needs', name: 'Rent' })],
    goals: [],
    accounts: [],
    breakdowns: [],
    temporaryItems: [makeTemporaryItem({ id: 't1', name: 'Holiday' })],
    members: [],
    allowances: [],
    onUpdateAllowance: vi.fn(),
    onCreateLine: vi.fn(),
    onUpdateLine: vi.fn(),
    onUpdateDerivedLine: vi.fn(),
    onDeleteLine: vi.fn(),
    onCreateItem: vi.fn(),
    onUpdateItem: vi.fn(),
    onDeleteItem: vi.fn(),
    ...overrides,
  }
  render(
    <MemoryRouter>
      <BudgetScreen {...props} />
    </MemoryRouter>,
  )
  return props
}

describe('BudgetScreen', () => {
  it('renders the budget-line list and the temporary-item list', () => {
    renderScreen()
    expect(screen.getByRole('heading', { name: 'Budget' })).toBeInTheDocument()
    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('Holiday')).toBeInTheDocument()
  })

  it('routes a budget-line delete through onDeleteLine', async () => {
    const user = userEvent.setup()
    const onDeleteLine = vi.fn()
    renderScreen({ onDeleteLine })

    const card = screen.getByText('Rent').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /delete/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(onDeleteLine).toHaveBeenCalledWith('l1'))
  })

  it('opens a prefilled Discretionary add form for a promoted wishlist item and clears it on save', async () => {
    const user = userEvent.setup()
    const onCreateLine = vi.fn().mockResolvedValue(undefined)
    const onPromoteConsumed = vi.fn()
    renderScreen({
      promoteDraft: { name: 'New couch', amountCents: 3_500_00 },
      onCreateLine,
      onPromoteConsumed,
    })

    expect(screen.getByText(/new budget item from your wishlist item/i)).toBeInTheDocument()
    const form = screen.getByText(/new budget item from your wishlist item/i).closest('div')!
    expect(within(form).getByLabelText(/name/i)).toHaveValue('New couch')

    await user.click(within(form).getByRole('button', { name: /add item/i }))
    await waitFor(() =>
      expect(onCreateLine).toHaveBeenCalledWith(
        expect.objectContaining({
          line_group: 'discretionary',
          name: 'New couch',
          amount_cents: 3_500_00,
        }),
      ),
    )
    expect(onPromoteConsumed).toHaveBeenCalledOnce()
  })

  it('clears a promoted wishlist budget draft when its form is cancelled', async () => {
    const user = userEvent.setup()
    const onPromoteConsumed = vi.fn()
    renderScreen({ promoteDraft: { name: 'New couch', amountCents: 3_500_00 }, onPromoteConsumed })

    const form = screen.getByText(/new budget item from your wishlist item/i).closest('div')!
    await user.click(within(form).getByRole('button', { name: /cancel/i }))
    expect(onPromoteConsumed).toHaveBeenCalledOnce()
  })

  it('routes a temporary-item delete through onDeleteItem', async () => {
    const user = userEvent.setup()
    const onDeleteItem = vi.fn()
    renderScreen({ onDeleteItem })

    const card = screen.getByText('Holiday').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /delete/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(onDeleteItem).toHaveBeenCalledWith('t1'))
  })

  it('lists each member’s allowance and offers it on a new Discretionary item', async () => {
    const user = userEvent.setup()
    renderScreen({
      members: [{ id: 'm1', name: 'Ada' }],
      allowances: [makeMemberAllowance()],
    })

    expect(screen.getByRole('heading', { name: 'Spending allowances' })).toBeInTheDocument()
    expect(screen.getByText('Ada’s allowance')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Discretionary item' }))
    await user.click(screen.getByRole('combobox', { name: /draw from allowance/i }))
    expect(await screen.findByRole('option', { name: 'Ada’s allowance' })).toBeInTheDocument()
  })

  it('routes an allowance edit through onUpdateAllowance', async () => {
    const user = userEvent.setup()
    const onUpdateAllowance = vi.fn().mockResolvedValue(undefined)
    renderScreen({
      members: [{ id: 'm1', name: 'Ada' }],
      allowances: [makeMemberAllowance()],
      onUpdateAllowance,
    })

    const card = screen.getByText('Ada’s allowance').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).queryByRole('button', { name: 'Delete' })).toBeNull()
    await user.click(within(card).getByRole('button', { name: 'Edit' }))
    const amount = screen.getByLabelText(/ada’s allowance/i)
    await user.clear(amount)
    await user.type(amount, '100')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(onUpdateAllowance).toHaveBeenCalledWith(
        'al1',
        expect.objectContaining({ amount_cents: 100_00 }),
      ),
    )
  })

  it('offers the allowance on a promoted wishlist item', async () => {
    const user = userEvent.setup()
    renderScreen({
      promoteDraft: { name: 'Headphones', amountCents: 300_00 },
      members: [{ id: 'm1', name: 'Ada' }],
      allowances: [makeMemberAllowance()],
    })

    const form = screen.getByText(/new budget item from your wishlist item/i).closest('div')!
    await user.click(within(form).getByRole('combobox', { name: /draw from allowance/i }))
    expect(await screen.findByRole('option', { name: 'Ada’s allowance' })).toBeInTheDocument()
  })
})
