import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EquityExerciseRow } from '../hooks/useEquityExercises'
import type { EquityGrantRow } from '../hooks/useEquityGrants'
import type { EquitySaleRow } from '../hooks/useEquitySales'
import { makeMember } from '../test/fixtures'
import { render, screen, setWideViewport, waitFor, within } from '../test/render'
import { EquityScreen } from './EquityScreen'

const will = makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })
const sam = makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' })

function makeGrant(overrides: Partial<EquityGrantRow> = {}): EquityGrantRow {
  return {
    id: 'eg1',
    household_id: 'h1',
    member_id: 'm1',
    label: '2024 shares',
    instrument_type: 'share',
    quantity: 48,
    grant_date: '2024-01-15',
    cliff_months: 12,
    vesting_period_months: 48,
    vesting_frequency: 'monthly',
    strike_price_cents: null,
    price_per_share_cents: 1_00,
    price_as_of: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

// At this date the sample grant has 12 of 48 units vested (12 whole months in),
// worth 12 × $1.00 = $12.00.
const asOf = new Date('2025-01-15')

function renderScreen(overrides: Partial<Parameters<typeof EquityScreen>[0]> = {}) {
  return render(
    <EquityScreen
      members={[will, sam]}
      grants={[makeGrant()]}
      exercises={[]}
      sales={[]}
      asOf={asOf}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onUpdate={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onCreateExercise={vi.fn().mockResolvedValue(undefined)}
      onUpdateExercise={vi.fn().mockResolvedValue(undefined)}
      onDeleteExercise={vi.fn().mockResolvedValue(undefined)}
      onCreateSale={vi.fn().mockResolvedValue(undefined)}
      onUpdateSale={vi.fn().mockResolvedValue(undefined)}
      onDeleteSale={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  )
}

describe('EquityScreen', () => {
  it('shows an empty hint per member without grants', () => {
    renderScreen({ grants: [] })
    expect(screen.getAllByText(/no grants yet/i)).toHaveLength(2)
  })

  it('renders a grant with its vested quantity and current value', () => {
    renderScreen()
    const card = screen.getByText('2024 shares').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText('Shares')).toBeInTheDocument()
    expect(within(card).getByText(/12 \/ 48 vested/)).toBeInTheDocument()
    expect(within(card).getByText('$12.00')).toBeInTheDocument()
  })

  it('shows a single value for a share grant, with no strike breakdown', () => {
    renderScreen()
    const card = screen.getByText('2024 shares').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText('$12.00')).toBeInTheDocument()
    expect(within(card).queryByText(/Exercise cost/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/Counts as/)).not.toBeInTheDocument()
  })

  it('spells out an option grant as vested value and exercise cost', () => {
    // 12 vested × $1.00 = $12.00 gross; × $0.40 strike = $4.80 exercise cost;
    // net $7.20 counts toward net worth.
    renderScreen({
      grants: [
        makeGrant({
          label: '2024 options',
          instrument_type: 'option',
          strike_price_cents: 40,
        }),
      ],
    })
    const card = screen.getByText('2024 options').closest('.mantine-Card-root') as HTMLElement
    // The dimmed detail line shows only gross vested value and exercise cost;
    // the net is the bold headline, not repeated here.
    expect(
      within(card).getByText(/Vested value \$12\.00 · Exercise cost \$4\.80/),
    ).toBeInTheDocument()
    expect(within(card).queryByText(/Counts as/)).not.toBeInTheDocument()
    // The bold headline figure is the net that counts toward net worth.
    expect(within(card).getByText('$7.20')).toBeInTheDocument()
  })

  it('edits a grant in place and saves the change', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    renderScreen({ onUpdate })

    const card = screen.getByText('2024 shares').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('eg1', expect.objectContaining({})))
  })

  it('confirms before deleting a grant', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderScreen({ onDelete })

    const card = screen.getByText('2024 shares').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(card).getByRole('button', { name: /delete/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('eg1')
  })

  it('adds a new grant', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    // A single member keeps one "Add grant" affordance, so the open form's submit
    // is unambiguous.
    renderScreen({ members: [will], grants: [], onCreate })

    await user.click(screen.getByRole('button', { name: /add grant/i }))
    await user.type(screen.getByLabelText(/^label$/i), 'New options')
    await user.type(screen.getByLabelText(/^quantity$/i), '1000')
    await user.type(screen.getByLabelText(/price per share/i), '2')
    await user.click(screen.getByRole('button', { name: /^add grant$/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'New options',
          quantity: 1000,
          price_per_share_cents: 200,
        }),
      ),
    )
  })

  describe('on desktop', () => {
    it('renders each grant as a dense row, breaking out an option grant', () => {
      setWideViewport()
      renderScreen({
        members: [will],
        grants: [
          makeGrant(),
          makeGrant({
            id: 'eg2',
            label: '2024 options',
            instrument_type: 'option',
            strike_price_cents: 50,
          }),
        ],
      })

      // No bordered card wraps a row.
      expect(screen.getByText('2024 shares').closest('.mantine-Card-root')).toBeNull()
      // Both grants share the sample's 12-of-48 vested position.
      expect(screen.getAllByText(/12 \/ 48 vested/)).toHaveLength(2)
      // Only the option grant carries the gross-value / exercise-cost caption.
      expect(screen.getByText(/Vested value .+ Exercise cost/)).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(2)
    })
  })
  it('values exercised options as shares and drops sold units from holdings', () => {
    // 12 of 48 options vested at $1.00 with a $0.40 strike. 5 are exercised and 2
    // of those sold: 7 unexercised options are worth 7 × $0.60 = $4.20 and 3 held
    // shares 3 × $1.00 = $3.00.
    const exercise: EquityExerciseRow = {
      id: 'ex1',
      household_id: 'h1',
      member_id: 'm1',
      grant_id: 'eg1',
      exercised_on: '2024-12-01',
      quantity: 5,
      strike_price_cents: 40,
      market_price_per_share_cents: 90,
      created_at: '',
      updated_at: '',
    }
    const sale: EquitySaleRow = {
      id: 's1',
      household_id: 'h1',
      member_id: 'm1',
      grant_id: 'eg1',
      sold_on: '2025-01-02',
      quantity: 2,
      price_per_share_cents: 1_00,
      fee_cents: 0,
      created_at: '',
      updated_at: '',
    }
    renderScreen({
      grants: [
        makeGrant({ label: '2024 options', instrument_type: 'option', strike_price_cents: 40 }),
      ],
      exercises: [exercise],
      sales: [sale],
    })
    const card = screen.getByText('2024 options').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText('$7.20')).toBeInTheDocument()
    expect(within(card).getByText(/5 exercised · 2 sold · 3 shares held/)).toBeInTheDocument()
    expect(screen.getByText('5 × 2024 options')).toBeInTheDocument()
    expect(screen.getByText('2 × 2024 options')).toBeInTheDocument()
  })

  it('records an exercise against an option grant', async () => {
    const user = userEvent.setup()
    const onCreateExercise = vi.fn().mockResolvedValue(undefined)
    renderScreen({
      members: [will],
      grants: [makeGrant({ label: 'Opts', instrument_type: 'option', strike_price_cents: 40 })],
      onCreateExercise,
    })
    await user.click(screen.getByRole('button', { name: /record exercise/i }))
    await user.type(screen.getByLabelText(/options exercised/i), '10')
    await user.click(screen.getByRole('button', { name: /^add exercise$/i }))
    await waitFor(() =>
      expect(onCreateExercise).toHaveBeenCalledWith(
        expect.objectContaining({ grant_id: 'eg1', quantity: 10, strike_price_cents: 40 }),
      ),
    )
  })

  it('refuses a sale beyond the shares held', async () => {
    const user = userEvent.setup()
    const onCreateSale = vi.fn().mockResolvedValue(undefined)
    renderScreen({ members: [will], onCreateSale })
    await user.click(screen.getByRole('button', { name: /record sale/i }))
    await user.type(screen.getByLabelText(/shares sold/i), '49')
    await user.type(screen.getByLabelText(/price per share/i), '2')
    expect(screen.getByText(/only 48 shares are left to sell/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add sale$/i })).toBeDisabled()
    expect(onCreateSale).not.toHaveBeenCalled()
  })

  it('records a sale', async () => {
    const user = userEvent.setup()
    const onCreateSale = vi.fn().mockResolvedValue(undefined)
    renderScreen({ members: [will], onCreateSale })
    await user.click(screen.getByRole('button', { name: /record sale/i }))
    await user.type(screen.getByLabelText(/shares sold/i), '4')
    await user.type(screen.getByLabelText(/price per share/i), '2')
    await user.clear(screen.getByLabelText(/fees/i))
    await user.type(screen.getByLabelText(/fees/i), '5')
    await user.click(screen.getByRole('button', { name: /^add sale$/i }))
    await waitFor(() =>
      expect(onCreateSale).toHaveBeenCalledWith(
        expect.objectContaining({
          grant_id: 'eg1',
          quantity: 4,
          price_per_share_cents: 200,
          fee_cents: 500,
        }),
      ),
    )
  })

  it('confirms before deleting an exercise or a sale', async () => {
    const user = userEvent.setup()
    const onDeleteExercise = vi.fn().mockResolvedValue(undefined)
    const onDeleteSale = vi.fn().mockResolvedValue(undefined)
    renderScreen({
      members: [will],
      grants: [
        makeGrant({ label: '2024 options', instrument_type: 'option', strike_price_cents: 40 }),
      ],
      exercises: [
        {
          id: 'ex1',
          household_id: 'h1',
          member_id: 'm1',
          grant_id: 'eg1',
          exercised_on: '2024-12-01',
          quantity: 5,
          strike_price_cents: 40,
          market_price_per_share_cents: null,
          created_at: '',
          updated_at: '',
        },
      ],
      sales: [
        {
          id: 's1',
          household_id: 'h1',
          member_id: 'm1',
          grant_id: 'eg1',
          sold_on: '2025-01-02',
          quantity: 2,
          price_per_share_cents: 1_00,
          fee_cents: 50,
          created_at: '',
          updated_at: '',
        },
      ],
      onDeleteExercise,
      onDeleteSale,
    })
    for (const [title, handler, id] of [
      ['5 × 2024 options', onDeleteExercise, 'ex1'],
      ['2 × 2024 options', onDeleteSale, 's1'],
    ] as const) {
      const card = screen.getByText(title).closest('.mantine-Card-root') as HTMLElement
      await user.click(within(card).getByRole('button', { name: /delete/i }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /delete/i }))
      expect(handler).toHaveBeenCalledWith(id)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
  })

  it('defaults an exercise to the strike of the grant chosen', async () => {
    const user = userEvent.setup()
    const onCreateExercise = vi.fn().mockResolvedValue(undefined)
    renderScreen({
      members: [will],
      grants: [
        makeGrant({ label: 'Opts A', instrument_type: 'option', strike_price_cents: 40 }),
        makeGrant({
          id: 'eg2',
          label: 'Opts B',
          instrument_type: 'option',
          strike_price_cents: 75,
        }),
      ],
      onCreateExercise,
    })
    await user.click(screen.getByRole('button', { name: /record exercise/i }))
    await user.click(screen.getAllByLabelText(/^grant$/i)[0]!)
    await user.click(await screen.findByRole('option', { name: 'Opts B' }))
    await user.type(screen.getByLabelText(/options exercised/i), '3')
    await user.click(screen.getByRole('button', { name: /^add exercise$/i }))
    await waitFor(() =>
      expect(onCreateExercise).toHaveBeenCalledWith(
        expect.objectContaining({ grant_id: 'eg2', quantity: 3, strike_price_cents: 75 }),
      ),
    )
  })
})
