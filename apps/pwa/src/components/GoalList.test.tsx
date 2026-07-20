import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '../test/render'
import { GoalList } from './GoalList'
import type { Goal } from '../hooks/useGoals'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Saver } from '../hooks/useSavers'

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    household_id: 'h1',
    name: 'Goal',
    target_amount_cents: 1_000_000,
    target_date: null,
    current_balance_cents: 0,
    linked_account_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function saver(overrides: Partial<Saver> = {}): Saver {
  return {
    id: 'a1',
    household_id: 'h1',
    owner_member_id: null,
    name: 'Up Saver',
    type: 'savings',
    source: 'up',
    external_id: 'up-a1',
    balance_cents: 0,
    currency: 'AUD',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function line(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: Math.random().toString(),
    household_id: 'h1',
    line_group: 'savings',
    name: 'Line',
    amount_cents: 50_000,
    frequency: 'fortnightly',
    interval_weeks: null,
    goal_id: null,
    derived_source: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function card(name: string): HTMLElement {
  return screen.getByText(name).closest('.mantine-Card-root') as HTMLElement
}

describe('GoalList', () => {
  it('projects fortnights and completion date for an on-track goal', () => {
    const goals = [goal({ id: 'g1', name: 'Car', target_amount_cents: 1_000_000 })]
    const lines = [line({ goal_id: 'g1', amount_cents: 50_000, frequency: 'fortnightly' })]
    render(
      <GoalList
        goals={goals}
        lines={lines}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const car = card('Car')
    expect(within(car).getByText('On track')).toBeInTheDocument()
    // Remaining $10,000 at $500/fn → 20 fortnights.
    expect(within(car).getByText(/20 fortnights/)).toBeInTheDocument()
    expect(within(car).getByText('$0.00 of $10,000.00')).toBeInTheDocument()
    expect(within(car).getByText('0%')).toBeInTheDocument()
  })

  it('shows the required contribution and on-track status for a dated goal', () => {
    const goals = [
      goal({
        id: 'g1',
        name: 'Trip',
        target_amount_cents: 1_000_000,
        current_balance_cents: 0,
        target_date: '2035-01-01',
      }),
    ]
    const lines = [line({ goal_id: 'g1', amount_cents: 50_000, frequency: 'fortnightly' })]
    render(
      <GoalList
        goals={goals}
        lines={lines}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const trip = card('Trip')
    expect(within(trip).getByText('On track')).toBeInTheDocument()
    expect(within(trip).getByText(/By 1 Jan 2035 needs .+\/fn/)).toBeInTheDocument()
  })

  it('marks an already-met goal as reached at 100%', () => {
    const goals = [
      goal({
        id: 'g1',
        name: 'Fund',
        target_amount_cents: 500_000,
        current_balance_cents: 600_000,
      }),
    ]
    render(
      <GoalList
        goals={goals}
        lines={[]}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const fund = card('Fund')
    expect(within(fund).getByText('Reached')).toBeInTheDocument()
    expect(within(fund).getByText('Goal reached.')).toBeInTheDocument()
    expect(within(fund).getByText('100%')).toBeInTheDocument()
  })

  it('handles a goal with no linked contribution gracefully', () => {
    const goals = [goal({ id: 'g1', name: 'Someday', target_amount_cents: 1_000_000 })]
    render(
      <GoalList
        goals={goals}
        lines={[]}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const someday = card('Someday')
    expect(within(someday).getByText('No ETA')).toBeInTheDocument()
    expect(within(someday).getByText(/link a savings line/i)).toBeInTheDocument()
    expect(within(someday).queryByText(/linked contribution/i)).toBeNull()
  })

  it('sums many linked lines into one goal contribution', () => {
    const goals = [goal({ id: 'g1', name: 'Deposit', target_amount_cents: 2_000_000 })]
    const lines = [
      line({ goal_id: 'g1', amount_cents: 50_000, frequency: 'fortnightly' }),
      line({ goal_id: 'g1', amount_cents: 30_000, frequency: 'fortnightly' }),
      line({ goal_id: 'other', amount_cents: 99_000, frequency: 'fortnightly' }),
    ]
    render(
      <GoalList
        goals={goals}
        lines={lines}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const deposit = card('Deposit')
    expect(within(deposit).getByText('Linked contribution $800.00 / fn')).toBeInTheDocument()
  })

  it('lists goals with an active contribution before those without', () => {
    const goals = [goal({ id: 'g1', name: 'Someday' }), goal({ id: 'g2', name: 'Funded' })]
    const lines = [line({ goal_id: 'g2', amount_cents: 50_000, frequency: 'fortnightly' })]
    render(
      <GoalList
        goals={goals}
        lines={lines}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const cards = screen.getAllByText(/Someday|Funded/)
    expect(cards.map((node) => node.textContent)).toEqual(['Funded', 'Someday'])
  })

  it('edits a goal in place', async () => {
    const user = userEvent.setup()
    render(
      <GoalList
        goals={[goal({ id: 'g1', name: 'Car' })]}
        lines={[]}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(within(card('Car')).getByRole('button', { name: /edit/i }))

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toHaveValue('Car')
  })

  it('opens the add-goal form', async () => {
    const user = userEvent.setup()
    render(
      <GoalList
        goals={[]}
        lines={[]}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add goal/i }))
    expect(screen.getByRole('button', { name: /add goal/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/target amount/i)).toBeInTheDocument()
  })

  it('uses a linked saver balance for progress and ETA, not the manual value', () => {
    const goals = [
      goal({
        id: 'g1',
        name: 'House',
        target_amount_cents: 1_000_000,
        current_balance_cents: 100_000,
        linked_account_id: 'a1',
      }),
    ]
    render(
      <GoalList
        goals={goals}
        lines={[]}
        savers={[saver({ id: 'a1', name: 'Up House', balance_cents: 600_000 })]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const house = card('House')
    // The saver's $6,000 balance, not the manual $1,000.
    expect(within(house).getByText('$6,000.00 of $10,000.00')).toBeInTheDocument()
    expect(within(house).getByText('60%')).toBeInTheDocument()
    expect(within(house).getByText('From Up saver Up House')).toBeInTheDocument()
  })

  it('uses the manual balance for an unlinked goal', () => {
    const goals = [
      goal({
        id: 'g1',
        name: 'Manual',
        target_amount_cents: 1_000_000,
        current_balance_cents: 250_000,
      }),
    ]
    render(
      <GoalList
        goals={goals}
        lines={[]}
        savers={[saver({ id: 'a1', balance_cents: 900_000 })]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const manual = card('Manual')
    expect(within(manual).getByText('$2,500.00 of $10,000.00')).toBeInTheDocument()
    expect(within(manual).getByText('25%')).toBeInTheDocument()
    expect(within(manual).queryByText(/from up saver/i)).toBeNull()
  })
})
