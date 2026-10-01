import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TradeRow } from '../hooks/useTrades'
import { render, screen, waitFor } from '../test/render'
import { TradeForm } from './TradeForm'

const member = { id: 'm1', name: 'Will' }

function makeTrade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 't1',
    household_id: 'h1',
    member_id: 'm1',
    ticker: 'VAS',
    side: 'buy',
    traded_on: '2026-02-03',
    units: 12.5,
    price_per_unit_microdollars: 98_500_000,
    fee_cents: 9_50,
    source: 'manual',
    document_id: null,
    external_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('TradeForm', () => {
  it('submits a buy with an upper-cased ticker and money in cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TradeForm member={member} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/^ticker$/i), ' vas ')
    await user.type(screen.getByLabelText(/^units$/i), '10.5')
    await user.type(screen.getByLabelText(/price per unit/i), '90')
    await user.type(screen.getByLabelText(/brokerage fee/i), '9.5')
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          member_id: 'm1',
          ticker: 'VAS',
          side: 'buy',
          units: 10.5,
          price_per_unit_microdollars: 90_000_000,
          fee_cents: 9_50,
        }),
      ),
    )
  })

  it('submits a sell when Sell is chosen', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TradeForm member={member} onSubmit={onSubmit} />)

    await user.click(screen.getByText('Sell'))
    await user.type(screen.getByLabelText(/^ticker$/i), 'NDQ')
    await user.type(screen.getByLabelText(/^units$/i), '3')
    await user.type(screen.getByLabelText(/price per unit/i), '40')
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'sell', ticker: 'NDQ', fee_cents: 0 }),
      ),
    )
  })

  it('disables the submit until a ticker, units, and price are given', async () => {
    const user = userEvent.setup()
    render(<TradeForm member={member} onSubmit={vi.fn()} />)

    const submit = screen.getByRole('button', { name: /^add trade$/i })
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/^ticker$/i), 'VAS')
    await user.type(screen.getByLabelText(/^units$/i), '1')
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/price per unit/i), '90')
    expect(submit).toBeEnabled()
  })

  it('reopens an existing trade with its values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TradeForm member={member} initial={makeTrade()} onSubmit={onSubmit} />)

    expect(screen.getByLabelText(/^ticker$/i)).toHaveValue('VAS')
    expect(screen.getByLabelText(/^units$/i)).toHaveValue('12.5')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        member_id: 'm1',
        ticker: 'VAS',
        side: 'buy',
        traded_on: '2026-02-03',
        units: 12.5,
        price_per_unit_microdollars: 98_500_000,
        fee_cents: 9_50,
      }),
    )
  })

  it('starts from a draft read from a document, with its own labels and notice', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(
      <TradeForm
        member={member}
        initial={{ ticker: 'NDQ', side: 'sell', traded_on: '2026-03-04', units: 3 }}
        notice={<p>Check the price.</p>}
        submitLabel="Save trade"
        cancelLabel="Discard"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('Check the price.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^ticker$/i)).toHaveValue('NDQ')
    expect(screen.getByRole('button', { name: /^save trade$/i })).toBeDisabled()
    await user.type(screen.getByLabelText(/price per unit/i), '40')
    await user.click(screen.getByRole('button', { name: /^save trade$/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          side: 'sell',
          units: 3,
          price_per_unit_microdollars: 40_000_000,
        }),
      ),
    )
    await user.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('warns when the entry repeats an existing trade, but still saves it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TradeForm member={member} trades={[makeTrade()]} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/^ticker$/i), 'VAS')
    await user.clear(screen.getByLabelText(/^date$/i))
    await user.type(screen.getByLabelText(/^date$/i), '3 Feb 2026')
    await user.type(screen.getByLabelText(/^units$/i), '12.5')
    await user.type(screen.getByLabelText(/price per unit/i), '98.5')

    expect(await screen.findByText(/already have a trade with this ticker/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  it('accepts a price to six decimal places and submits it exactly', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TradeForm member={member} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/^ticker$/i), 'IOZ')
    await user.type(screen.getByLabelText(/^units$/i), '2')
    await user.type(screen.getByLabelText(/price per unit/i), '33.083072')
    await user.click(screen.getByRole('button', { name: /^add trade$/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ price_per_unit_microdollars: 33_083_072 }),
      ),
    )
  })

  it('shows a saved partial-cent price without trailing noise', () => {
    render(
      <TradeForm
        member={member}
        initial={makeTrade({ price_per_unit_microdollars: 33_083_072 })}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/price per unit/i)).toHaveValue('$33.083072')
  })

  it('does not call prices that differ by a fraction of a cent a repeat', async () => {
    const user = userEvent.setup()
    render(
      <TradeForm
        member={member}
        trades={[makeTrade({ price_per_unit_microdollars: 98_500_001 })]}
        onSubmit={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText(/^ticker$/i), 'VAS')
    await user.clear(screen.getByLabelText(/^date$/i))
    await user.type(screen.getByLabelText(/^date$/i), '3 Feb 2026')
    await user.type(screen.getByLabelText(/^units$/i), '12.5')
    await user.type(screen.getByLabelText(/price per unit/i), '98.5')

    expect(screen.queryByText(/already have a trade/i)).not.toBeInTheDocument()
  })

  it('does not count the trade being edited as its own repeat', () => {
    render(
      <TradeForm member={member} initial={makeTrade()} trades={[makeTrade()]} onSubmit={vi.fn()} />,
    )

    expect(screen.queryByText(/already have a trade/i)).not.toBeInTheDocument()
  })
})
