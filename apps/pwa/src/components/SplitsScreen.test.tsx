import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '../test/render'
import { SplitsScreen } from './SplitsScreen'
import type { Account } from '../hooks/useAccounts'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal } from '../hooks/useGoals'

function account(overrides: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  return {
    household_id: 'h1',
    owner_member_id: null,
    type: 'transaction',
    source: 'manual',
    external_id: null,
    balance_cents: 0,
    currency: 'AUD',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function line(overrides: Partial<BudgetLine> & Pick<BudgetLine, 'id' | 'line_group'>): BudgetLine {
  return {
    household_id: 'h1',
    name: 'Line',
    amount_cents: 0,
    frequency: 'fortnightly',
    interval_weeks: null,
    goal_id: null,
    derived_source: null,
    destination_account_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function goal(overrides: Partial<Goal> & Pick<Goal, 'id'>): Goal {
  return {
    household_id: 'h1',
    name: 'Goal',
    target_amount_cents: 0,
    target_date: null,
    current_balance_cents: 0,
    linked_account_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function renderScreen(overrides: Partial<Parameters<typeof SplitsScreen>[0]> = {}) {
  return render(
    <SplitsScreen
      accounts={[]}
      lines={[]}
      goals={[]}
      onRefresh={vi.fn()}
      refreshing={false}
      refreshError={null}
      {...overrides}
    />,
  )
}

describe('SplitsScreen', () => {
  it('recommends a saver pay split from a goal-routed savings line', () => {
    const saver = account({ id: 's1', name: 'Emergency', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [line({ id: 'l1', line_group: 'savings', amount_cents: 500_00, goal_id: 'g1' })],
    })

    expect(screen.getByText('Recommended pay splits')).toBeInTheDocument()
    expect(screen.getByText('Emergency')).toBeInTheDocument()
    expect(screen.getByText('$500.00')).toBeInTheDocument()
  })

  it('rounds a split up to the next $5 and shows the exact figure', () => {
    const everyday = account({ id: 't1', name: 'Everyday', type: 'transaction' })
    renderScreen({
      accounts: [everyday],
      lines: [
        line({ id: 'l1', line_group: 'needs', amount_cents: 101_00, destination_account_id: 't1' }),
      ],
    })

    expect(screen.getByText('Stays in your everyday account')).toBeInTheDocument()
    expect(screen.getByText('$105.00')).toBeInTheDocument()
    expect(screen.getByText('$101.00 exact')).toBeInTheDocument()
  })

  it('nudges about budget lines not yet routed to an account', () => {
    renderScreen({
      lines: [line({ id: 'l1', line_group: 'wants', amount_cents: 50_00 })],
    })

    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByText(/\$50\.00 \/ fn comes from budget lines/)).toBeInTheDocument()
  })

  it('shows an empty state when nothing is routed', () => {
    renderScreen()
    expect(screen.getByText(/route budget lines to an account/i)).toBeInTheDocument()
  })

  it('calls onRefresh when the button is clicked', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    renderScreen({ onRefresh })

    await user.click(screen.getByRole('button', { name: /refresh/i }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })
})
