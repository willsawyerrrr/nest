import { describe, expect, it } from 'vitest'
import { makeAccount, makeMember } from '../test/fixtures'
import { render, screen, setWideViewport, within } from '../test/render'
import { AccountsScreen } from './AccountsScreen'

const members = [makeMember({ id: 'm1', name: 'Alex' })]

const accounts = [
  makeAccount({
    id: 'sp',
    name: "💳 Alex's Spending",
    type: 'transaction',
    owner_member_id: 'm1',
    balance_cents: 250_00,
  }),
  makeAccount({ id: 'sv', name: '🏖️ Holiday', type: 'savings', balance_cents: 1_000_00 }),
  makeAccount({
    id: 'old',
    name: 'Old saver',
    type: 'savings',
    balance_cents: 0,
    deleted_from_source_at: '2026-10-01T00:00:00Z',
    exclude_from_net_worth: true,
  }),
  makeAccount({
    id: 'hl',
    name: 'Home loan',
    type: 'home_loan',
    source: 'redbark',
    balance_cents: -400_000_00,
  }),
]

describe('AccountsScreen', () => {
  it('groups accounts by type with each group total', () => {
    render(<AccountsScreen accounts={accounts} members={members} />)

    const sections = screen
      .getAllByRole('region')
      .map((section) => section.getAttribute('aria-label'))
    expect(sections).toEqual(['Spending', 'Savings', 'Home loan'])
    expect(
      within(screen.getByRole('region', { name: 'Savings' })).getAllByText('$1,000.00'),
    ).toHaveLength(2)
  })

  it('shows each account with its owner, source and status badges on mobile cards', () => {
    render(<AccountsScreen accounts={accounts} members={members} />)

    expect(screen.getAllByTestId('account-card')).toHaveLength(4)
    expect(screen.getByText("Alex's Spending")).toBeInTheDocument()
    expect(screen.getByText('Alex · Up')).toBeInTheDocument()
    expect(screen.getByText('Joint · Redbark')).toBeInTheDocument()
    expect(screen.getByText('Deleted at source')).toBeInTheDocument()
    expect(screen.getByText('Not in net worth')).toBeInTheDocument()
  })

  it('renders dense rows on a wide viewport', () => {
    setWideViewport()
    render(<AccountsScreen accounts={accounts} members={members} />)

    expect(screen.getAllByTestId('account-row')).toHaveLength(4)
    const row = screen.getAllByTestId('account-row')[0]!
    expect(within(row).getByText('Alex')).toBeInTheDocument()
    expect(within(row).getByText('Up')).toBeInTheDocument()
    expect(within(row).getByText('$250.00')).toBeInTheDocument()
  })

  it('tints negative balances only', () => {
    render(<AccountsScreen accounts={accounts} members={members} />)

    const loan = within(screen.getByRole('region', { name: 'Home loan' }))
    expect(loan.getAllByText('-$400,000.00')[0]).toHaveStyle({
      color: expect.stringContaining('negative') as string,
    })
    expect(screen.getAllByText('$250.00')[0]?.getAttribute('style')).not.toContain('positive')
  })

  it('says so when there are no accounts', () => {
    render(<AccountsScreen accounts={[]} members={members} />)
    expect(screen.getByText(/No accounts yet/)).toBeInTheDocument()
  })
})
