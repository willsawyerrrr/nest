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

  it('shows an empty state per group when no accounts qualify', () => {
    render(<NetWorthView accounts={[]} superIds={new Set()} onToggleExclude={vi.fn()} />)

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
      <NetWorthView accounts={withExcluded} superIds={new Set(['a1'])} onToggleExclude={vi.fn()} />,
    )

    const excluded = screen.getByRole('region', { name: 'Excluded from net worth' })
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
        onToggleExclude={onToggleExclude}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exclude Holiday saver from net worth' }))
    expect(onToggleExclude).toHaveBeenCalledWith('a3', true)

    fireEvent.click(screen.getByRole('button', { name: 'Include Rainy day in net worth' }))
    expect(onToggleExclude).toHaveBeenCalledWith('a4', false)
  })
})
