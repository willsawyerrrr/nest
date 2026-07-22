import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EquityGrantRow } from '../hooks/useEquityGrants'
import { makeMember } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
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
      asOf={asOf}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onUpdate={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
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

  it('breaks an option grant into gross, exercise cost, and net', () => {
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
    expect(
      within(card).getByText(/Vested value \$12\.00 · Exercise cost \$4\.80 · Counts as \$7\.20/),
    ).toBeInTheDocument()
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
})
