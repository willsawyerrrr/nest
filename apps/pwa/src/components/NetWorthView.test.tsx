import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../hooks/useAccounts'
import { fireEvent, render, screen, within } from '../test/render'
import { NetWorthView } from './NetWorthView'

function account(
  overrides: Partial<Account> & Pick<Account, 'id' | 'name' | 'balance_cents'>,
): Account {
  return {
    household_id: 'h1',
    currency: 'AUD',
    exclude_from_net_worth: false,
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

  it('lists liabilities as negative figures and subtracts them from the total', () => {
    render(
      <NetWorthView
        accounts={[account({ id: 'a1', name: 'Holiday saver', balance_cents: 500000 })]}
        superIds={new Set()}
        liabilities={[
          { label: 'Will HELP debt', balanceCents: 3000000 },
          { label: 'Sam HELP debt', balanceCents: 1000000 },
        ]}
        onToggleExclude={vi.fn()}
      />,
    )

    const liabilities = screen.getByRole('region', { name: 'Liabilities' })
    expect(within(liabilities).getByText('Will HELP debt')).toBeInTheDocument()
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

  it('offers no Edit affordance when only super accounts exist', () => {
    render(
      <NetWorthView
        accounts={[account({ id: 'a1', name: 'Will Super', balance_cents: 12500000 })]}
        superIds={new Set(['a1'])}
        liabilities={[]}
        onToggleExclude={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
