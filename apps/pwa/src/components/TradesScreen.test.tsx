import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TradeRow } from '../hooks/useTrades'
import { makeMember } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { TradesScreen } from './TradesScreen'

const will = makeMember({ id: 'm1', name: 'Will' })
const sam = makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' })

function makeTrade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 't1',
    household_id: 'h1',
    member_id: 'm1',
    ticker: 'VAS',
    side: 'buy',
    traded_on: '2024-01-10',
    units: 100,
    price_per_unit_cents: 90_00,
    fee_cents: 0,
    source: 'manual',
    external_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function renderScreen(overrides: Partial<Parameters<typeof TradesScreen>[0]> = {}) {
  return render(
    <TradesScreen
      members={[will, sam]}
      trades={[]}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onUpdate={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  )
}

describe('TradesScreen', () => {
  it('shows an empty hint per member without trades', () => {
    renderScreen()
    expect(screen.getAllByText(/no trades yet/i)).toHaveLength(2)
  })

  it('shows a holding with its units, average cost, cost base, and value at the last price', () => {
    renderScreen({
      trades: [
        makeTrade({ fee_cents: 10_00 }),
        makeTrade({ id: 't2', traded_on: '2024-06-01', units: 50, price_per_unit_cents: 100_00 }),
      ],
    })
    const holdings = screen.getByLabelText("Will's holdings")
    expect(within(holdings).getByText('VAS')).toBeInTheDocument()
    expect(within(holdings).getByText(/150 units/)).toBeInTheDocument()
    // Cost base $9,000 + $10 fee + $5,000 = $14,010.00; average $93.40.
    expect(within(holdings).getByText(/Average cost \$93\.40/)).toBeInTheDocument()
    expect(within(holdings).getByText(/Cost base \$14,010\.00/)).toBeInTheDocument()
    // 150 units at the last traded price of $100.00.
    expect(within(holdings).getByText('$15,000.00')).toBeInTheDocument()
    expect(screen.queryByLabelText("Sam's holdings")).not.toBeInTheDocument()
  })

  it('summarises realised gains per financial year with the discount', () => {
    renderScreen({
      trades: [
        makeTrade(),
        makeTrade({
          id: 't2',
          side: 'sell',
          traded_on: '2026-09-01',
          price_per_unit_cents: 110_00,
        }),
      ],
    })
    const gains = screen.getByLabelText("Will's realised gains")
    expect(within(gains).getByText('FY2027')).toBeInTheDocument()
    expect(within(gains).getByText(/Gains \$2,000\.00/)).toBeInTheDocument()
    expect(within(gains).getByText(/CGT discount \$1,000\.00/)).toBeInTheDocument()
    expect(within(gains).getByText('$1,000.00')).toBeInTheDocument()
  })

  it('warns about units sold beyond those bought', () => {
    renderScreen({
      trades: [makeTrade({ units: 5 }), makeTrade({ id: 't2', side: 'sell', units: 8 })],
    })
    expect(screen.getByText(/3 VAS sold on .* exceed the units bought/)).toBeInTheDocument()
  })

  it('edits a trade in place and saves the change', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    renderScreen({ members: [will], trades: [makeTrade()], onUpdate })

    const card = screen.getByText('Buy').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('t1', expect.objectContaining({})))
  })

  it('confirms before deleting a trade', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderScreen({ members: [will], trades: [makeTrade()], onDelete })

    const card = screen.getByText('Buy').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /delete/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('t1')
  })

  it('names a sell by its side in the delete confirmation', async () => {
    const user = userEvent.setup()
    renderScreen({
      members: [will],
      trades: [makeTrade(), makeTrade({ id: 't2', side: 'sell', units: 1 })],
    })

    const card = screen.getByText('Sell').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /delete/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Sell VAS/)).toBeInTheDocument()
  })

  it('adds a trade', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderScreen({ members: [will], onCreate })

    await user.click(screen.getByRole('button', { name: /add trade/i }))
    await user.type(screen.getByLabelText(/^ticker$/i), 'vas')
    await user.type(screen.getByLabelText(/^units$/i), '10')
    await user.type(screen.getByLabelText(/price per unit/i), '90')
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ ticker: 'VAS', units: 10, price_per_unit_cents: 90_00 }),
      ),
    )
  })
})
