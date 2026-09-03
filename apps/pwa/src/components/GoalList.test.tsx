import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { planningStorageKey } from '../lib/planningMode'
import { makeGoal as goal, makeBudgetLine as line, makeSaver as saver } from '../test/fixtures'
import { render, screen, setWideViewport, waitFor, within } from '../test/render'
import { GoalList } from './GoalList'
import { PlanningModeProvider } from './PlanningModeProvider'

afterEach(() => localStorage.clear())

/** Renders a `GoalList` inside an active planning-mode sandbox. */
function renderPlanning(ui: React.ReactElement) {
  localStorage.setItem(planningStorageKey('h1'), JSON.stringify({ active: true, overrides: {} }))
  return render(<PlanningModeProvider householdId="h1">{ui}</PlanningModeProvider>)
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
    expect(within(trip).getByText(/By 1 Jan 2035 needs .+\/ fn/)).toBeInTheDocument()
  })

  it('marks a dated goal behind when its contribution falls short of what it needs', () => {
    const goals = [
      goal({
        id: 'g1',
        name: 'Wedding',
        target_amount_cents: 1_000_000,
        current_balance_cents: 0,
        target_date: '2027-01-01',
      }),
    ]
    const lines = [line({ goal_id: 'g1', amount_cents: 1_00, frequency: 'fortnightly' })]
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

    const wedding = card('Wedding')
    expect(within(wedding).getByText('Behind')).toBeInTheDocument()
    expect(within(wedding).getByText(/contributing/)).toBeInTheDocument()
  })

  it('names a single fortnight in the singular when an undated goal completes in one', () => {
    const goals = [goal({ id: 'g1', name: 'Sprint', target_amount_cents: 50_000 })]
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

    // $500 remaining at $500/fn reaches the target in exactly one fortnight.
    expect(within(card('Sprint')).getByText(/^1 fortnight —/)).toBeInTheDocument()
  })

  it('shows 100% for a zero-target goal', () => {
    const goals = [goal({ id: 'g1', name: 'Placeholder', target_amount_cents: 0 })]
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

    expect(within(card('Placeholder')).getByText('100%')).toBeInTheDocument()
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
    expect(within(someday).getByText(/link a savings item/i)).toBeInTheDocument()
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

  it('saves an inline edit and closes the form', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(
      <GoalList
        goals={[goal({ id: 'g1', name: 'Car' })]}
        lines={[]}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />,
    )

    await user.click(within(card('Car')).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('g1', expect.objectContaining({ name: 'Car' })),
    )
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
  })

  it('creates a goal from the add form and closes it', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <GoalList
        goals={[]}
        lines={[]}
        savers={[]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /add goal/i }))
    await user.type(screen.getByLabelText(/name/i), 'Holiday')
    await user.type(screen.getByLabelText(/target amount/i), '5000')
    await user.click(screen.getByRole('button', { name: /add goal/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Holiday', target_amount_cents: 500_000 }),
      ),
    )
    expect(screen.queryByLabelText(/target amount/i)).not.toBeInTheDocument()
  })

  it('deletes a goal after confirming', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <GoalList
        goals={[goal({ id: 'g1', name: 'Car' })]}
        lines={[]}
        savers={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={onDelete}
      />,
    )

    await user.click(within(card('Car')).getByRole('button', { name: /delete/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    expect(onDelete).toHaveBeenCalledWith('g1')
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

  it('flags a goal whose linked saver was deleted in Up and prompts a relink', () => {
    const goals = [
      goal({ id: 'g1', name: 'House', target_amount_cents: 1_000_000, linked_account_id: 'a1' }),
    ]
    render(
      <GoalList
        goals={goals}
        lines={[]}
        savers={[
          saver({
            id: 'a1',
            name: 'Up House',
            balance_cents: 600_000,
            deleted_from_source_at: '2026-09-01T00:00:00Z',
          }),
        ]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const house = card('House')
    expect(within(house).getByText('Deleted in Up')).toBeInTheDocument()
    expect(within(house).getByText(/relink the goal to a current saver/i)).toBeInTheDocument()
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

  describe('planning-mode comparison', () => {
    it('shows a required-contribution move for a dated goal whose target changed', () => {
      const goals = [
        goal({ id: 'g1', name: 'Trip', target_amount_cents: 2_000_000, target_date: '2035-01-01' }),
      ]
      const baselineGoals = [
        goal({ id: 'g1', name: 'Trip', target_amount_cents: 1_000_000, target_date: '2035-01-01' }),
      ]
      renderPlanning(
        <GoalList
          goals={goals}
          lines={[]}
          savers={[]}
          baselineGoals={baselineGoals}
          baselineLines={[]}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
      const trip = card('Trip')
      expect(within(trip).getByText(/needs/)).toBeInTheDocument()
      expect(within(trip).getByText(/→/)).toBeInTheDocument()
    })

    it('shows an ETA move for an undated goal whose contribution changed', () => {
      const goals = [goal({ id: 'g1', name: 'Car', target_amount_cents: 1_000_000 })]
      const lines = [line({ goal_id: 'g1', amount_cents: 100_000, frequency: 'fortnightly' })]
      const baselineLines = [
        line({ goal_id: 'g1', amount_cents: 25_000, frequency: 'fortnightly' }),
      ]
      renderPlanning(
        <GoalList
          goals={goals}
          lines={lines}
          savers={[]}
          baselineGoals={goals}
          baselineLines={baselineLines}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
      const car = card('Car')
      // The faster contribution brings the completion date sooner.
      expect(within(car).getByText(/sooner\)/)).toBeInTheDocument()
    })

    it('keeps the plain ETA string when nothing moved it', () => {
      const goals = [goal({ id: 'g1', name: 'Car', target_amount_cents: 1_000_000 })]
      const lines = [line({ goal_id: 'g1', amount_cents: 50_000, frequency: 'fortnightly' })]
      renderPlanning(
        <GoalList
          goals={goals}
          lines={lines}
          savers={[]}
          baselineGoals={goals}
          baselineLines={lines}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
      expect(within(card('Car')).getByText(/fortnights —/)).toBeInTheDocument()
      expect(within(card('Car')).queryByText(/→/)).not.toBeInTheDocument()
    })
  })

  describe('on desktop', () => {
    it('renders each goal as a dense row with its status, percent, and ETA', () => {
      setWideViewport()
      const goals = [
        goal({ id: 'g1', name: 'Car', target_amount_cents: 1_000_000, linked_account_id: 'a1' }),
        goal({ id: 'g2', name: 'Trip', target_amount_cents: 1_000_000 }),
      ]
      const lines = [line({ goal_id: 'g1', amount_cents: 50_000, frequency: 'fortnightly' })]
      render(
        <GoalList
          goals={goals}
          lines={lines}
          savers={[saver({ id: 'a1', name: 'Up Car', balance_cents: 500_000 })]}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />,
      )

      // No bordered card wraps a row.
      expect(screen.getByText('Car').closest('.mantine-Card-root')).toBeNull()
      // The saver-linked goal shows its saver in the caption; the plain goal does not.
      expect(screen.getByText(/From Up saver Up Car/)).toBeInTheDocument()
      expect(screen.getByText('50%')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(2)
    })
  })
})
