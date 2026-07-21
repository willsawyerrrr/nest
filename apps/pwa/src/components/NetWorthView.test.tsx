import { describe, expect, it } from 'vitest'
import type { Account } from '../hooks/useAccounts'
import { render, screen, within } from '../test/render'
import { NetWorthView } from './NetWorthView'

function account(
  overrides: Partial<Account> & Pick<Account, 'id' | 'name' | 'balance_cents'>,
): Account {
  return {
    household_id: 'h1',
    currency: 'AUD',
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
    render(<NetWorthView accounts={accounts} superIds={new Set(['a1', 'a2'])} />)

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
    render(<NetWorthView accounts={[]} superIds={new Set()} />)

    expect(screen.getByText(/no super accounts yet/i)).toBeInTheDocument()
    expect(screen.getByText(/no other accounts yet/i)).toBeInTheDocument()
    const total = screen.getByRole('region', { name: 'Total net worth' })
    expect(within(total).getByText('$0.00')).toBeInTheDocument()
  })
})
