import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeBudgetLine, makeTemporaryItem } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { BudgetScreen } from './BudgetScreen'

function renderScreen(overrides: Partial<Parameters<typeof BudgetScreen>[0]> = {}) {
  const props: Parameters<typeof BudgetScreen>[0] = {
    lines: [makeBudgetLine({ id: 'l1', line_group: 'needs', name: 'Rent' })],
    goals: [],
    accounts: [],
    breakdowns: [],
    temporaryItems: [makeTemporaryItem({ id: 't1', name: 'Holiday' })],
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
})
