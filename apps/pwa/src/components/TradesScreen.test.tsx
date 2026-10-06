import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TradeDocumentRow } from '../hooks/useTradeDocuments'
import type { TradeRow } from '../hooks/useTrades'
import { makeMember } from '../test/fixtures'
import { render, screen, setWideViewport, waitFor, within } from '../test/render'
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
    price_per_unit_microdollars: 90_000_000,
    fee_cents: 0,
    source: 'manual',
    document_id: null,
    external_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function makeActions(overrides = {}) {
  return {
    upload: vi.fn().mockResolvedValue('h1/d1/note.pdf'),
    discard: vi.fn().mockResolvedValue(undefined),
    extract: vi.fn().mockResolvedValue({ status: 'failed', message: 'Not a contract note.' }),
    save: vi.fn().mockResolvedValue(undefined),
    signedUrl: vi.fn().mockResolvedValue('https://x/doc'),
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
      documents={[]}
      documentActions={makeActions()}
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
        makeTrade({
          id: 't2',
          traded_on: '2024-06-01',
          units: 50,
          price_per_unit_microdollars: 100_000_000,
        }),
      ],
    })
    const holdings = screen.getByLabelText("Will's holdings")
    expect(within(holdings).getByText('VAS')).toBeInTheDocument()
    expect(within(holdings).getByText(/150 units/)).toBeInTheDocument()
    // Cost base $9,000 + $10 fee + $5,000 = $14,010.00; average $93.40.
    expect(within(holdings).getByText(/Avg cost \$93\.40/)).toBeInTheDocument()
    expect(within(holdings).getByText(/Cost base \$14,010\.00/)).toBeInTheDocument()
    // 150 units at the last traded price of $100.00.
    expect(within(holdings).getByText('$15,000.00')).toBeInTheDocument()
    expect(screen.queryByLabelText("Sam's holdings")).not.toBeInTheDocument()
  })

  it('shows exact unit prices, with the average cost and last price to the microdollar', () => {
    renderScreen({
      trades: [
        makeTrade({
          units: 2,
          price_per_unit_microdollars: 33_083_072,
          fee_cents: 2_00,
        }),
      ],
    })
    const holdings = screen.getByLabelText("Will's holdings")
    // Cost base: 2 × $33.083072 = $66.17 (rounded once) + $2.00 = $68.17; $34.085 each.
    expect(within(holdings).getByText(/Avg cost \$34\.085 /)).toBeInTheDocument()
    expect(within(holdings).getByText(/Cost base \$68\.17/)).toBeInTheDocument()
    expect(within(holdings).getByText('at $33.083072')).toBeInTheDocument()
    expect(within(holdings).getByText('$66.17')).toBeInTheDocument()
    expect(screen.getByText(/2 units . at \$33\.083072 . \$2\.00 brokerage/)).toBeInTheDocument()
    // 2 × $33.083072 = $66.17, shown beside the trade.
    expect(screen.getAllByText('$66.17')).toHaveLength(2)
  })

  it('summarises realised gains per financial year with the discount', () => {
    renderScreen({
      trades: [
        makeTrade(),
        makeTrade({
          id: 't2',
          side: 'sell',
          traded_on: '2026-09-01',
          price_per_unit_microdollars: 110_000_000,
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

  it('lays summaries and trades out as dense rows on a wide viewport', async () => {
    setWideViewport()
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const signedUrl = vi.fn().mockResolvedValue(null)
    renderScreen({
      members: [will],
      onDelete,
      documentActions: makeActions({ signedUrl }),
      documents: [
        {
          id: 'd1',
          storage_path: 'h1/d1/note.pdf',
        } as TradeDocumentRow,
      ],
      trades: [
        makeTrade({ document_id: 'd1', fee_cents: 9_50 }),
        makeTrade({ id: 't2', side: 'sell', traded_on: '2026-09-01', units: 40 }),
      ],
    })

    expect(within(screen.getByLabelText("Will's holdings")).getByText('VAS')).toBeInTheDocument()
    expect(
      within(screen.getByLabelText("Will's realised gains")).getByText('FY2027'),
    ).toBeInTheDocument()
    expect(screen.getByText('100 units')).toBeInTheDocument()
    // Both trades and the holding's last price.
    expect(screen.getAllByText('at $90.00')).toHaveLength(3)
    expect(screen.getByTitle('Brokerage $9.50')).toHaveTextContent('$9.50')
    expect(screen.getByTitle('No brokerage')).toHaveTextContent('\u2014')
    expect(screen.getByText('$9,000.00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Document' }))
    await waitFor(() => expect(signedUrl).toHaveBeenCalledWith('h1/d1/note.pdf'))

    await user.click(screen.getAllByRole('button', { name: /delete/i })[0]!)
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /delete/i }),
    )
    expect(onDelete).toHaveBeenCalled()
  })

  it('says one unit in the singular and fractional units in the plural', () => {
    renderScreen({
      members: [will],
      trades: [makeTrade({ units: 1 }), makeTrade({ id: 't2', units: 1.5 })],
    })
    expect(screen.getByText(/ 1 unit . at/)).toBeInTheDocument()
    expect(screen.getByText(/ 1\.5 units . at/)).toBeInTheDocument()
  })

  it('adds a trade', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    renderScreen({ members: [will], onCreate })

    await user.click(screen.getByRole('button', { name: /add trade/i }))
    await user.click(screen.getByRole('button', { name: /enter details manually/i }))
    await user.type(screen.getByLabelText(/^ticker$/i), 'vas')
    await user.type(screen.getByLabelText(/^units$/i), '10')
    await user.type(screen.getByLabelText(/price per unit/i), '90')
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          ticker: 'VAS',
          units: 10,
          price_per_unit_microdollars: 90_000_000,
        }),
      ),
    )
  })

  it('links a trade read from a document to the stored file', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const signedUrl = vi.fn().mockResolvedValue('https://x/doc')
    renderScreen({
      members: [will],
      trades: [makeTrade({ document_id: 'd1' }), makeTrade({ id: 't2' })],
      documents: [{ id: 'd1', household_id: 'h1', storage_path: 'h1/d1/note.pdf', created_at: '' }],
      documentActions: makeActions({ signedUrl }),
    })

    expect(screen.getAllByRole('button', { name: /^document$/i })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /^document$/i }))

    await waitFor(() => expect(open).toHaveBeenCalledWith('https://x/doc', '_blank', 'noopener'))
    expect(signedUrl).toHaveBeenCalledWith('h1/d1/note.pdf')
    open.mockRestore()
  })

  it('opens nothing when the document cannot be found or signed', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const signedUrl = vi.fn().mockResolvedValue(null)
    renderScreen({
      members: [will],
      trades: [makeTrade({ document_id: 'd1' }), makeTrade({ id: 't2', document_id: 'd2' })],
      documents: [{ id: 'd1', household_id: 'h1', storage_path: 'h1/d1/note.pdf', created_at: '' }],
      documentActions: makeActions({ signedUrl }),
    })

    for (const link of screen.getAllByRole('button', { name: /^document$/i })) {
      await user.click(link)
    }

    await waitFor(() => expect(signedUrl).toHaveBeenCalledTimes(1))
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('opens the Add trade card with a contract note picker and closes it once a document-backed trade is saved', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    const extract = vi.fn().mockResolvedValue({
      status: 'read',
      trades: [
        {
          values: {
            ticker: 'VAS',
            side: 'buy',
            traded_on: '2026-07-06',
            units: 2,
            price_per_unit_microdollars: 90_000_000,
          },
          check: [],
        },
      ],
    })
    renderScreen({ members: [will], documentActions: makeActions({ extract, save }) })

    await user.click(screen.getByRole('button', { name: /^add trade$/i }))
    await user.upload(
      document.querySelector('input[type="file"][multiple]:not([aria-label])') as HTMLInputElement,
      new File(['x'], 'note.pdf', { type: 'application/pdf' }),
    )
    await screen.findByText(/extracted from the contract note by AI/i)
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))

    await waitFor(() => expect(save).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByLabelText('Contract note')).not.toBeInTheDocument())
  })
})
