import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeSaver as account, makeGoal as goal, makeBudgetLine as line } from '../test/fixtures'
import { render, screen, setWideViewport, within } from '../test/render'
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
      onClear={vi.fn()}
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

  it('badges a routed saver that the sync flagged as deleted in Up', () => {
    const saver = account({
      id: 's1',
      name: 'Emergency',
      source: 'up',
      type: 'savings',
      deleted_from_source_at: '2026-09-01T00:00:00Z',
    })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [line({ id: 'l1', line_group: 'savings', amount_cents: 500_00, goal_id: 'g1' })],
    })

    expect(screen.getByText('Deleted in Up')).toBeInTheDocument()
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

  it('attributes a gift member line to the buyer’s spending account', () => {
    // A "Gifts for Sam" line auto-routed to Will's spending account joins the
    // recommended splits under that account.
    const pay = account({ id: 't1', name: 'Pay', type: 'transaction' })
    const buyer = account({ id: 'will-txn', name: 'Will’s Spending', type: 'transaction' })
    renderScreen({
      accounts: [pay, buyer],
      payAccountId: 't1',
      lines: [
        line({
          id: 'l1',
          line_group: 'wants',
          name: 'Gifts for Sam',
          amount_cents: 260_00,
          frequency: 'annual',
          destination_account_id: 'will-txn',
        }),
      ],
    })

    const confirmButton = screen.getByRole('button', { name: /mark as set/i })
    const recommendedCard = confirmButton.closest('.mantine-Card-root') as HTMLElement
    expect(within(recommendedCard).getByText('Will’s Spending')).toBeInTheDocument()
    // $260/year normalises to $10/fn.
    expect(within(recommendedCard).getByText('$10.00')).toBeInTheDocument()
  })

  it('nudges about budget lines not yet routed to an account', () => {
    renderScreen({
      lines: [line({ id: 'l1', line_group: 'wants', amount_cents: 50_00 })],
    })

    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByText(/\$50\.00 \/ fn comes from budget items/)).toBeInTheDocument()
  })

  it('shows an empty state when nothing is routed', () => {
    renderScreen()
    expect(screen.getByText(/route budget items to an account/i)).toBeInTheDocument()
  })

  it('expands a recommended account row to the budget lines behind its total', async () => {
    const user = userEvent.setup()
    const pay = account({ id: 't1', name: 'Pay', type: 'transaction' })
    const bills = account({ id: 't2', name: 'Bills', type: 'transaction' })
    renderScreen({
      accounts: [pay, bills],
      payAccountId: 't1',
      lines: [
        line({
          id: 'l1',
          name: 'Rent',
          line_group: 'needs',
          amount_cents: 300_00,
          destination_account_id: 't2',
        }),
        line({
          id: 'l2',
          name: 'Power',
          line_group: 'needs',
          amount_cents: 100_00,
          destination_account_id: 't2',
        }),
      ],
    })

    const toggle = screen.getByRole('button', { name: /bills/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // The two lines behind the $400 / fn total, each with its own fortnightly figure.
    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('Power')).toBeInTheDocument()
    expect(screen.getByText('$300.00 / fn')).toBeInTheDocument()
    expect(screen.getByText('$100.00 / fn')).toBeInTheDocument()
  })

  it('expands a staying-put account row to its lines', async () => {
    const user = userEvent.setup()
    const pay = account({ id: 't1', name: 'Pay', type: 'transaction' })
    renderScreen({
      accounts: [pay],
      payAccountId: 't1',
      lines: [
        line({
          id: 'l1',
          name: 'Mortgage',
          line_group: 'needs',
          amount_cents: 200_00,
          destination_account_id: 't1',
        }),
      ],
    })

    const toggle = screen.getByRole('button', { name: /^pay$/i })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Mortgage')).toBeInTheDocument()
  })

  it('keeps Confirm working on an expanded recommended row', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const saver = account({ id: 's1', name: 'Groceries', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [
        line({
          id: 'l1',
          name: 'Weekly shop',
          line_group: 'savings',
          amount_cents: 500_00,
          goal_id: 'g1',
        }),
      ],
      configuredByAccount: new Map([['s1', 350_00]]),
      onConfirm,
    })

    await user.click(screen.getByRole('button', { name: /groceries/i }))
    expect(screen.getByText('Weekly shop')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^confirm$/i }))
    expect(onConfirm).toHaveBeenCalledWith('s1', 500_00)
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

  it('renders the split rows as dense desktop rows outside cards', () => {
    setWideViewport()
    const pay = account({ id: 't1', name: 'Pay', type: 'transaction' })
    const bills = account({ id: 't2', name: 'Bills', type: 'transaction' })
    const saver = account({ id: 's1', name: 'Emergency', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [pay, bills, saver],
      payAccountId: 't1',
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [
        line({ id: 'l1', line_group: 'needs', amount_cents: 200_00, destination_account_id: 't1' }),
        line({ id: 'l2', line_group: 'needs', amount_cents: 150_00, destination_account_id: 't2' }),
        line({ id: 'l3', line_group: 'savings', amount_cents: 300_00, goal_id: 'g1' }),
      ],
      // Bills drifts from its configured split; the saver matches, so it renders plainly.
      configuredByAccount: new Map([
        ['t2', 100_00],
        ['s1', 300_00],
      ]),
    })

    // The drifting recommended row is a dense row, not a bordered card, and still
    // flags its drift with an Update badge, a change note, and a Confirm control.
    const confirm = screen.getByRole('button', { name: /confirm/i })
    expect(confirm.closest('.mantine-Card-root')).toBeNull()
    expect(screen.getByText('Update')).toBeInTheDocument()
    expect(screen.getByText('was $100.00 → $150.00 / fn')).toBeInTheDocument()

    // No split row anywhere renders inside a bordered card on desktop.
    const label = (name: string) =>
      screen.getAllByText(name).find((node) => node.tagName === 'P') as HTMLElement
    expect(label('Bills').closest('.mantine-Card-root')).toBeNull()
    expect(label('Emergency').closest('.mantine-Card-root')).toBeNull()
    expect(label('Pay').closest('.mantine-Card-root')).toBeNull()
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

  it('clears a confirmed split even when it matches the recommendation', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    const saver = account({ id: 's1', name: 'Groceries', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [line({ id: 'l1', line_group: 'savings', amount_cents: 500_00, goal_id: 'g1' })],
      configuredByAccount: new Map([['s1', 500_00]]),
      onClear,
    })

    await user.click(screen.getByRole('button', { name: 'Clear pay split' }))
    expect(onClear).toHaveBeenCalledWith('s1')
  })

  it('offers no Clear on a recommendation that was never confirmed', () => {
    const saver = account({ id: 's1', name: 'Groceries', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [line({ id: 'l1', line_group: 'savings', amount_cents: 500_00, goal_id: 'g1' })],
      configuredByAccount: new Map(),
    })

    expect(screen.getByText('Not set in Up yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear pay split' })).not.toBeInTheDocument()
  })

  it('offers Clear alongside Confirm on a drifted confirmed split', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    const saver = account({ id: 's1', name: 'Groceries', source: 'up', type: 'savings' })
    renderScreen({
      accounts: [saver],
      goals: [goal({ id: 'g1', linked_account_id: 's1' })],
      lines: [line({ id: 'l1', line_group: 'savings', amount_cents: 501_00, goal_id: 'g1' })],
      configuredByAccount: new Map([['s1', 350_00]]),
      onClear,
    })

    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear pay split' }))
    expect(onClear).toHaveBeenCalledWith('s1')
  })
})
