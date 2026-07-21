import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, within } from '../test/render'
import { GiftsScreen } from './GiftsScreen'
import type { GiftBudget, GiftOccasion, GiftPurchase, GiftRecipient } from '../hooks/useGifts'

const alice: GiftRecipient = {
  id: 'r1',
  name: 'Alice',
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
        {...overrides}
      />
    </MemoryRouter>,
  )
}

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

  it('preselects a saved date when editing and persists it on save', async () => {
    const user = userEvent.setup()
    const onUpdateBudget = vi.fn()
    renderScreen({ budgets: [{ ...budget, event_date: '2026-11-15' }], onUpdateBudget })

    // Groups default collapsed, so expand the occasion group before its rows show.
    await user.click(screen.getByRole('button', { name: /Christmas/ }))
    await user.click(screen.getByRole('button', { name: /Alice/ }))
    await user.click(screen.getByRole('button', { name: 'Edit budget' }))

    expect(screen.getByLabelText('Date')).toHaveValue('15 Nov 2026')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onUpdateBudget).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ event_date: '2026-11-15' }),
    )
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
      household_id: 'h',
      created_at: '',
      updated_at: '',
    }
    renderScreen({ purchases: [purchase] })

    expect(screen.getAllByText('Left $70.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('Left $100.00')).not.toBeInTheDocument()
  })
})
