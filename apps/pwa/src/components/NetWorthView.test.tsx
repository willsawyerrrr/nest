import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetWorthProjectionPoint } from '@nest/plan'
import type { Account } from '../hooks/useAccounts'
import { planningStorageKey } from '../lib/planningMode'
import { fireEvent, render, screen, within } from '../test/render'
import { NetWorthView } from './NetWorthView'
import { PlanningModeProvider } from './PlanningModeProvider'

afterEach(() => localStorage.clear())

function account(
  overrides: Partial<Account> & Pick<Account, 'id' | 'name' | 'balance_cents'>,
): Account {
  return {
    household_id: 'h1',
    currency: 'AUD',
    exclude_from_net_worth: false,
    deleted_from_source_at: null,
    external_id: null,
    owner_member_id: null,
    source: 'manual',
    type: 'savings',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const accounts: Account[] = [
  account({ id: 'a1', name: 'Will Super', balance_cents: 12500000 }),
  account({ id: 'a2', name: 'Partner Super', balance_cents: 7500000 }),
  account({ id: 'a3', name: 'Holiday saver', balance_cents: 200000, source: 'up' }),
]

describe('NetWorthView', () => {
  it('splits accounts into super and other with subtotals and a grand total', () => {
    render(
      <NetWorthView
        accounts={accounts}
        superIds={new Set(['a1', 'a2'])}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )

    const superSection = screen.getByRole('region', { name: 'Super' })
    expect(within(superSection).getByText('Will Super')).toBeInTheDocument()
    expect(within(superSection).getByText('Partner Super')).toBeInTheDocument()
    expect(within(superSection).getByText('$200,000.00')).toBeInTheDocument()

    const otherSection = screen.getByRole('region', { name: 'Other accounts' })
    expect(within(otherSection).getByText('Holiday saver')).toBeInTheDocument()
    // The lone other account and the subtotal both read $2,000.00.
    expect(within(otherSection).getAllByText('$2,000.00')).toHaveLength(2)
    expect(within(otherSection).queryByText('Will Super')).not.toBeInTheDocument()

    // Grand total = 125000 + 75000 + 2000 = 202000 dollars.
    const total = screen.getByRole('region', { name: 'Total net worth' })
    expect(within(total).getByText('$202,000.00')).toBeInTheDocument()
  })

  it('lists equity holdings as positive figures and adds them to the total', () => {
    render(
      <NetWorthView
        accounts={[account({ id: 'a1', name: 'Holiday saver', balance_cents: 500000 })]}
        superIds={new Set()}
        equity={[
          { label: 'Will — 2024 options', valueCents: 3000000 },
          { label: 'Sam — 2023 shares', valueCents: 1000000 },
        ]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )

    const equity = screen.getByRole('region', { name: 'Equity' })
    expect(within(equity).getByText('Will — 2024 options')).toBeInTheDocument()
    expect(within(equity).getByText('$30,000.00')).toBeInTheDocument()
    expect(within(equity).getByText('$10,000.00')).toBeInTheDocument()
    // Subtotal: $30,000 + $10,000 = $40,000.
    expect(within(equity).getByText('$40,000.00')).toBeInTheDocument()

    // Grand total: $5,000 accounts + $40,000 equity = $45,000.
    const total = screen.getByRole('region', { name: 'Total net worth' })
    expect(within(total).getByText('$45,000.00')).toBeInTheDocument()

    // A dimmed caption clarifies the equity figure is net of the strike price.
    expect(within(equity).getByText(/net of the strike price/i)).toBeInTheDocument()
  })

  it('omits the equity group when there are no holdings', () => {
    render(
      <NetWorthView
        accounts={[account({ id: 'a1', name: 'Holiday saver', balance_cents: 500000 })]}
        superIds={new Set()}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )
    expect(screen.queryByRole('region', { name: 'Equity' })).not.toBeInTheDocument()
  })

  it('lists liabilities as negative figures and subtracts them from the total', () => {
    render(
      <NetWorthView
        accounts={[account({ id: 'a1', name: 'Holiday saver', balance_cents: 500000 })]}
        superIds={new Set()}
        equity={[]}
        liabilities={[
          { label: "Will's HELP debt", balanceCents: 3000000 },
          { label: "Sam's HELP debt", balanceCents: 1000000 },
        ]}
        onToggleExclude={vi.fn()}
      />,
    )

    const liabilities = screen.getByRole('region', { name: 'Liabilities' })
    expect(within(liabilities).getByText("Will's HELP debt")).toBeInTheDocument()
    expect(within(liabilities).getByText('-$30,000.00')).toBeInTheDocument()
    expect(within(liabilities).getByText('-$10,000.00')).toBeInTheDocument()
    // Subtotal: -($30,000 + $10,000) = -$40,000.
    expect(within(liabilities).getByText('-$40,000.00')).toBeInTheDocument()

    // Grand total: $5,000 assets − $40,000 liabilities = −$35,000.
    const total = screen.getByRole('region', { name: 'Total net worth' })
    expect(within(total).getByText('-$35,000.00')).toBeInTheDocument()
  })

  it('omits the liabilities group when there are none', () => {
    render(
      <NetWorthView
        accounts={[account({ id: 'a1', name: 'Holiday saver', balance_cents: 500000 })]}
        superIds={new Set()}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )
    expect(screen.queryByRole('region', { name: 'Liabilities' })).not.toBeInTheDocument()
  })

  it('shows an empty state per group when no accounts qualify', () => {
    render(
      <NetWorthView
        accounts={[]}
        superIds={new Set()}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )

    expect(screen.getByText(/no super accounts yet/i)).toBeInTheDocument()
    expect(screen.getByText(/no other accounts yet/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Excluded from net worth' }),
    ).not.toBeInTheDocument()
    const total = screen.getByRole('region', { name: 'Total net worth' })
    expect(within(total).getByText('$0.00')).toBeInTheDocument()
  })

  it('lists excluded accounts in a separate group, off the total', () => {
    const withExcluded: Account[] = [
      account({ id: 'a1', name: 'Will Super', balance_cents: 12500000 }),
      account({ id: 'a3', name: 'Holiday saver', balance_cents: 200000 }),
      account({ id: 'a4', name: 'Rainy day', balance_cents: 500000, exclude_from_net_worth: true }),
    ]
    render(
      <NetWorthView
        accounts={withExcluded}
        superIds={new Set(['a1'])}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )

    const excluded = screen.getByRole('region', { name: 'Excluded from net worth' })
    // The excluded group carries no subtotal (its balances are off the total),
    // and is collapsed by default — accounts appear only once expanded.
    const toggle = within(excluded).getByRole('button', { name: /excluded from net worth/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(excluded).queryByText('$5,000.00')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(excluded).getByText('Rainy day')).toBeInTheDocument()
    // Grand total counts only the included accounts: 125000 + 2000 dollars.
    const total = screen.getByRole('region', { name: 'Total net worth' })
    expect(within(total).getByText('$127,000.00')).toBeInTheDocument()
  })

  it('fires onToggleExclude in both directions', () => {
    const onToggleExclude = vi.fn()
    const withExcluded: Account[] = [
      account({ id: 'a3', name: 'Holiday saver', balance_cents: 200000 }),
      account({ id: 'a4', name: 'Rainy day', balance_cents: 500000, exclude_from_net_worth: true }),
    ]
    render(
      <NetWorthView
        accounts={withExcluded}
        superIds={new Set()}
        equity={[]}
        liabilities={[]}
        onToggleExclude={onToggleExclude}
      />,
    )

    // The toggle controls only appear once editing is turned on.
    expect(
      screen.queryByRole('button', { name: 'Exclude Holiday saver from net worth' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    fireEvent.click(screen.getByRole('button', { name: 'Exclude Holiday saver from net worth' }))
    expect(onToggleExclude).toHaveBeenCalledWith('a3', true)

    // The include control lives in the excluded group, collapsed by default.
    fireEvent.click(screen.getByRole('button', { name: /excluded from net worth/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Include Rainy day in net worth' }))
    expect(onToggleExclude).toHaveBeenCalledWith('a4', false)
  })

  it('shows the exclude controls only while editing, and never on super', () => {
    const withSuperAndOther: Account[] = [
      account({ id: 'a1', name: 'Will Super', balance_cents: 12500000 }),
      account({ id: 'a3', name: 'Holiday saver', balance_cents: 200000 }),
    ]
    render(
      <NetWorthView
        accounts={withSuperAndOther}
        superIds={new Set(['a1'])}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )

    // Not editing: no per-account controls anywhere.
    expect(
      screen.queryByRole('button', { name: 'Exclude Holiday saver from net worth' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    // Editing: the other account gains a control; super never does.
    expect(
      screen.getByRole('button', { name: 'Exclude Holiday saver from net worth' }),
    ).toBeInTheDocument()
    const superSection = screen.getByRole('region', { name: 'Super' })
    expect(within(superSection).queryByRole('button')).not.toBeInTheDocument()

    // Done hides the controls again.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(
      screen.queryByRole('button', { name: 'Exclude Holiday saver from net worth' }),
    ).not.toBeInTheDocument()
  })

  it('omits the projection chart when no projection is supplied', () => {
    render(
      <NetWorthView
        accounts={accounts}
        superIds={new Set(['a1', 'a2'])}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )
    expect(screen.queryByRole('region', { name: 'Net worth projection' })).not.toBeInTheDocument()
  })

  it('shows real → proposed on the total and projected net worth while planning mode is on', () => {
    localStorage.setItem(planningStorageKey('h1'), JSON.stringify({ active: true, overrides: {} }))
    const point = (year: number, totalCents: number): NetWorthProjectionPoint => ({
      year,
      superCents: totalCents,
      otherCents: 0,
      equityCents: 0,
      helpCents: 0,
      debtCents: 0,
      totalCents,
    })
    render(
      <PlanningModeProvider householdId="h1">
        <NetWorthView
          accounts={accounts}
          superIds={new Set(['a1', 'a2'])}
          equity={[]}
          liabilities={[]}
          projection={[point(0, 20_000_000), point(1, 30_000_000)]}
          projectionBaseYear={2026}
          baselineTotalCents={18_000_000}
          baselineProjectionEndCents={25_000_000}
          onToggleExclude={vi.fn()}
        />
      </PlanningModeProvider>,
    )
    const total = screen.getByRole('region', { name: 'Total net worth' })
    expect(within(total).getByText('$180,000.00')).toBeInTheDocument()
    expect(within(total).getByText('$202,000.00')).toBeInTheDocument()
    // Projected net worth line: $250,000.00 → $300,000.00
    expect(screen.getByText('$250,000.00')).toBeInTheDocument()
    expect(screen.getByText('$300,000.00')).toBeInTheDocument()
  })

  it('renders the projection chart when points carry data', () => {
    render(
      <NetWorthView
        accounts={accounts}
        superIds={new Set(['a1', 'a2'])}
        equity={[]}
        liabilities={[]}
        projection={[
          {
            year: 0,
            superCents: 20_000_000,
            otherCents: 200000,
            equityCents: 0,
            helpCents: 30_000_00,
            debtCents: 1_000_00,
            totalCents: 16_900_000,
          },
          {
            year: 1,
            superCents: 21_400_000,
            otherCents: 200000,
            equityCents: 5_000_00,
            helpCents: 20_000_00,
            debtCents: 1_000_00,
            totalCents: 19_100_000,
          },
        ]}
        projectionBaseYear={2026}
        onToggleExclude={vi.fn()}
      />,
    )
    // Collapsed by default: only the header shows until expanded.
    const chart = screen.getByRole('region', { name: 'Net worth projection' })
    expect(within(chart).queryByText(/itemised in the tooltip/i)).not.toBeInTheDocument()
    fireEvent.click(within(chart).getByRole('button', { name: 'Projected forward' }))
    // Expanded: assets are plotted as areas; liabilities stay in the total and the tooltip.
    expect(within(chart).getByText(/itemised in the tooltip/i)).toBeInTheDocument()
  })

  it('collapses the projection by default and toggles it open and shut', () => {
    render(
      <NetWorthView
        accounts={accounts}
        superIds={new Set(['a1', 'a2'])}
        equity={[]}
        liabilities={[]}
        projection={[
          {
            year: 0,
            superCents: 20_000_000,
            otherCents: 0,
            equityCents: 0,
            helpCents: 0,
            debtCents: 0,
            totalCents: 20_000_000,
          },
        ]}
        projectionBaseYear={2026}
        horizon="retirement"
        onHorizonChange={vi.fn()}
        onToggleExclude={vi.fn()}
      />,
    )
    const chart = screen.getByRole('region', { name: 'Net worth projection' })
    const toggle = within(chart).getByRole('button', { name: 'Projected forward' })
    // Collapsed: the header reports collapsed and the horizon control is absent.
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(chart).queryByRole('radiogroup', { name: 'Projection horizon' })).toBeNull()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(chart).getByRole('radiogroup', { name: 'Projection horizon' }),
    ).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(chart).queryByRole('radiogroup', { name: 'Projection horizon' })).toBeNull()
  })

  it('shows the projection empty state when every point is zero', () => {
    render(
      <NetWorthView
        accounts={[]}
        superIds={new Set()}
        equity={[]}
        liabilities={[]}
        projection={[
          {
            year: 0,
            superCents: 0,
            otherCents: 0,
            equityCents: 0,
            helpCents: 0,
            debtCents: 0,
            totalCents: 0,
          },
        ]}
        projectionBaseYear={2026}
        onToggleExclude={vi.fn()}
      />,
    )
    const chart = screen.getByRole('region', { name: 'Net worth projection' })
    fireEvent.click(within(chart).getByRole('button', { name: 'Projected forward' }))
    expect(within(chart).getByText(/project your net worth forward/i)).toBeInTheDocument()
  })

  it('renders the horizon control and reports the chosen option', () => {
    const onHorizonChange = vi.fn()
    render(
      <NetWorthView
        accounts={accounts}
        superIds={new Set(['a1', 'a2'])}
        equity={[]}
        liabilities={[]}
        projection={[
          {
            year: 0,
            superCents: 20_000_000,
            otherCents: 0,
            equityCents: 0,
            helpCents: 0,
            debtCents: 0,
            totalCents: 20_000_000,
          },
        ]}
        projectionBaseYear={2026}
        horizon="retirement"
        onHorizonChange={onHorizonChange}
        onToggleExclude={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Projected forward' }))
    const control = screen.getByRole('radiogroup', { name: 'Projection horizon' })
    expect(within(control).getByText('To retirement')).toBeInTheDocument()
    fireEvent.click(within(control).getByText('5y'))
    expect(onHorizonChange).toHaveBeenCalledWith('5y')
  })

  it('badges a deleted-in-Up account and removes it after confirming, warning about linked goals', async () => {
    const onRemoveAccount = vi.fn().mockResolvedValue(undefined)
    render(
      <NetWorthView
        accounts={[
          account({
            id: 'a3',
            name: 'Holiday saver',
            balance_cents: 200000,
            source: 'up',
            deleted_from_source_at: '2026-09-01T00:00:00Z',
          }),
        ]}
        superIds={new Set()}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
        onRemoveAccount={onRemoveAccount}
        linkedGoalNamesByAccount={new Map([['a3', ['Bali trip']]])}
      />,
    )

    const other = screen.getByRole('region', { name: 'Other accounts' })
    expect(within(other).getByText('Deleted in Up')).toBeInTheDocument()

    fireEvent.click(within(other).getByRole('button', { name: 'Remove from Nest' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Bali trip/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/ }))

    await screen.findByRole('region', { name: 'Other accounts' })
    expect(onRemoveAccount).toHaveBeenCalledWith('a3')
  })

  it('omits the Remove-from-Nest action when no handler is supplied', () => {
    render(
      <NetWorthView
        accounts={[
          account({
            id: 'a3',
            name: 'Holiday saver',
            balance_cents: 200000,
            source: 'up',
            deleted_from_source_at: '2026-09-01T00:00:00Z',
          }),
        ]}
        superIds={new Set()}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )

    expect(screen.getByText('Deleted in Up')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove from Nest' })).not.toBeInTheDocument()
  })

  it('offers no Edit affordance when only super accounts exist', () => {
    render(
      <NetWorthView
        accounts={[account({ id: 'a1', name: 'Will Super', balance_cents: 12500000 })]}
        superIds={new Set(['a1'])}
        equity={[]}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
