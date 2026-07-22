import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeSaver as account, makeGoal as goal, makeBudgetLine as line } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { SplitsScreen } from './SplitsScreen'

function renderScreen(overrides: Partial<Parameters<typeof SplitsScreen>[0]> = {}) {
  return render(
    <SplitsScreen
      accounts={[]}
      lines={[]}
      goals={[]}
      configuredByAccount={new Map()}
      payAccountId={null}
      onSetPayAccount={vi.fn()}
      onConfirm={vi.fn()}
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

  it('strips a saver’s leading emoji from its displayed name', () => {
    const saver = account({ id: 's1', name: '🏖️ Holiday', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [line({ id: 'l1', line_group: 'savings', amount_cents: 500_00, goal_id: 'g1' })],
    })

    expect(screen.getByText('Holiday')).toBeInTheDocument()
    expect(screen.queryByText('🏖️ Holiday')).not.toBeInTheDocument()
  })

  it('sorts the saver rows by title then by amount', async () => {
    const user = userEvent.setup()
    const alpha = account({ id: 's1', name: 'Alpha', source: 'up', type: 'savings' })
    const bravo = account({ id: 's2', name: 'Bravo', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [alpha, bravo],
      goals: [
        goal({ id: 'g1', linked_account_id: 's1' }),
        goal({ id: 'g2', linked_account_id: 's2' }),
      ],
      lines: [
        line({ id: 'l1', line_group: 'savings', amount_cents: 100_00, goal_id: 'g1' }),
        line({ id: 'l2', line_group: 'savings', amount_cents: 300_00, goal_id: 'g2' }),
      ],
    })

    // Default: title ascending lists Alpha before Bravo.
    expect(screen.getAllByText(/Alpha|Bravo/).map((node) => node.textContent)).toEqual([
      'Alpha',
      'Bravo',
    ])

    // Amount ascending keeps Alpha ($100) before Bravo ($300).
    await user.click(screen.getByRole('combobox', { name: /sort by/i }))
    await user.click(screen.getByRole('option', { name: 'Amount' }))
    expect(screen.getAllByText(/Alpha|Bravo/).map((node) => node.textContent)).toEqual([
      'Alpha',
      'Bravo',
    ])

    // Amount descending puts Bravo ($300) first.
    await user.click(screen.getByRole('button', { name: /toggle sort direction/i }))
    expect(screen.getAllByText(/Alpha|Bravo/).map((node) => node.textContent)).toEqual([
      'Bravo',
      'Alpha',
    ])
  })

  it('rounds a split up to the next $5 and shows the exact figure', () => {
    const spending = account({ id: 't1', name: 'Spending', type: 'transaction' })
    renderScreen({
      accounts: [spending],
      lines: [
        line({ id: 'l1', line_group: 'needs', amount_cents: 101_00, destination_account_id: 't1' }),
      ],
    })

    expect(screen.getByText('Stays in your spending account')).toBeInTheDocument()
    expect(screen.queryByText(/everyday/i)).not.toBeInTheDocument()
    expect(screen.getByText('$105.00')).toBeInTheDocument()
    expect(screen.getByText('$101.00 exact')).toBeInTheDocument()
  })

  it('designates the pay account through the “Paid into” selector', async () => {
    const user = userEvent.setup()
    const onSetPayAccount = vi.fn()
    const pay = account({ id: 't1', name: 'Pay', type: 'transaction' })
    renderScreen({ accounts: [pay], payAccountId: null, onSetPayAccount })

    await user.click(screen.getByRole('combobox', { name: 'Paid into' }))
    await user.click(screen.getByRole('option', { name: 'Pay' }))
    expect(onSetPayAccount).toHaveBeenCalledWith('t1')
  })

  it('prompts to choose the pay account when none is set and spending accounts exist', () => {
    const spending = account({ id: 't1', name: 'Spending', type: 'transaction' })
    renderScreen({
      accounts: [spending],
      payAccountId: null,
      lines: [
        line({ id: 'l1', line_group: 'needs', amount_cents: 100_00, destination_account_id: 't1' }),
      ],
    })

    expect(screen.getByText('Choose the account you’re paid into')).toBeInTheDocument()
  })

  it('splits to a non-pay spending account and keeps the pay account staying put', () => {
    const pay = account({ id: 't1', name: 'Pay', type: 'transaction' })
    const other = account({ id: 't2', name: 'Bills', type: 'transaction' })
    renderScreen({
      accounts: [pay, other],
      payAccountId: 't1',
      lines: [
        line({ id: 'l1', line_group: 'needs', amount_cents: 200_00, destination_account_id: 't1' }),
        line({ id: 'l2', line_group: 'needs', amount_cents: 150_00, destination_account_id: 't2' }),
      ],
    })

    // The non-pay spending account joins the recommended splits with a confirm affordance.
    expect(screen.getByText('Recommended pay splits')).toBeInTheDocument()
    const confirmButton = screen.getByRole('button', { name: /mark as set/i })
    const recommendedCard = confirmButton.closest('.mantine-Card-root') as HTMLElement
    expect(within(recommendedCard).getByText('Bills')).toBeInTheDocument()

    // The pay account stays put, with no transfer.
    const staysSection = screen.getByText('Stays in your pay account').closest('div') as HTMLElement
    expect(
      within(staysSection).getByText('Pay lands here — no transfer needed.'),
    ).toBeInTheDocument()
    expect(within(staysSection).getByText('Pay')).toBeInTheDocument()
    expect(screen.queryByText(/everyday/i)).not.toBeInTheDocument()
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

  it('flags a saver whose configured split differs and confirms the rounded amount', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const saver = account({ id: 's1', name: 'Groceries', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      // $501 rounds up to $505; the household confirmed $350 — a drift.
      lines: [line({ id: 'l1', line_group: 'savings', amount_cents: 501_00, goal_id: 'g1' })],
      configuredByAccount: new Map([['s1', 350_00]]),
      onConfirm,
    })

    expect(screen.getByText('was $350.00 → $505.00 / fn')).toBeInTheDocument()
    expect(screen.getByText('1 to update')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('s1', 505_00)
  })

  it('flags a saver with no configured split as needing to be set', () => {
    const saver = account({ id: 's1', name: 'Groceries', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [line({ id: 'l1', line_group: 'savings', amount_cents: 500_00, goal_id: 'g1' })],
      configuredByAccount: new Map(),
    })

    expect(screen.getByText('Not set in Up yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark as set/i })).toBeInTheDocument()
  })

  it('shows no status indicator when the configured split matches the recommendation', () => {
    const saver = account({ id: 's1', name: 'Groceries', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [line({ id: 'l1', line_group: 'savings', amount_cents: 500_00, goal_id: 'g1' })],
      configuredByAccount: new Map([['s1', 500_00]]),
    })

    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.queryByText(/up to date/i)).not.toBeInTheDocument()
    expect(screen.queryByText('set in Up')).not.toBeInTheDocument()
    expect(screen.queryByText(/to update/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Update')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm|mark as set/i })).not.toBeInTheDocument()
  })
})
