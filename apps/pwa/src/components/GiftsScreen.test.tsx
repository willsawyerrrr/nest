import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '../test/render'
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
  household_id: 'h',
  created_at: '',
  updated_at: '',
}

function renderScreen(overrides: Partial<Parameters<typeof GiftsScreen>[0]> = {}) {
  return render(
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
    />,
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
