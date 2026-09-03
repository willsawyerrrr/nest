import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { planningStorageKey } from '../lib/planningMode'
import { render, screen, within } from '../test/render'
import { PlanningModeProvider } from './PlanningModeProvider'
import {
  PlanningScreen,
  type PlanningGoalEta,
  type PlanningOverride,
  type PlanningRollupFigure,
} from './PlanningScreen'

afterEach(() => localStorage.clear())

const figures: PlanningRollupFigure[] = [
  { label: 'Fortnightly buffer', baselineCents: 10_000, proposedCents: 25_000, colored: true },
  { label: 'Annual tax', baselineCents: 30_000_00, proposedCents: 28_000_00 },
]
const goalEtas: PlanningGoalEta[] = [
  { name: 'Car', baselineIso: '2027-06-01', proposedIso: '2027-05-02' },
]

function renderScreen(
  overrides: PlanningOverride[],
  handlers: Partial<Parameters<typeof PlanningScreen>[0]> = {},
) {
  localStorage.setItem(planningStorageKey('h1'), JSON.stringify({ active: true, overrides: {} }))
  return render(
    <PlanningModeProvider householdId="h1">
      <PlanningScreen
        overrides={overrides}
        figures={figures}
        goalEtas={goalEtas}
        onResetRow={handlers.onResetRow ?? vi.fn()}
        onDiscard={handlers.onDiscard ?? vi.fn()}
        onExit={handlers.onExit ?? vi.fn()}
      />
    </PlanningModeProvider>,
  )
}

const anUpdate: PlanningOverride = {
  table: 'inflows',
  tableLabel: 'Inflow',
  id: 'i1',
  rowName: 'Day job',
  kind: 'update',
  changes: [{ field: 'amount_cents', was: '$1,000.00', now: '$1,500.00' }],
}

describe('PlanningScreen', () => {
  it('shows an empty state and a disabled Discard when nothing is pending', () => {
    renderScreen([])
    expect(screen.getByText(/no changes yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /discard changes/i })).toBeDisabled()
  })

  it('lists every override with its kind, name, and moved fields', () => {
    renderScreen([
      anUpdate,
      {
        table: 'savings_goal',
        tableLabel: 'Savings goal',
        id: 'g1',
        rowName: 'New car',
        kind: 'create',
        changes: [],
      },
      {
        table: 'budget_line',
        tableLabel: 'Budget line',
        id: 'b1',
        rowName: 'Gym',
        kind: 'delete',
        changes: [],
      },
    ])
    expect(screen.getByText('Edited')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Removed')).toBeInTheDocument()
    expect(screen.getByText(/amount: \$1,000\.00 → \$1,500\.00/)).toBeInTheDocument()
  })

  it('resets one row through its Reset control', async () => {
    const onResetRow = vi.fn()
    renderScreen([anUpdate], { onResetRow })
    await userEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(onResetRow).toHaveBeenCalledWith('inflows', 'i1')
  })

  it('rolls up the implications as real → proposed', () => {
    renderScreen([anUpdate])
    const impact = screen.getByRole('table', { name: 'Projected impact' })
    // The buffer moved $100.00 → $250.00.
    expect(within(impact).getByText('$100.00')).toBeInTheDocument()
    expect(within(impact).getByText('$250.00')).toBeInTheDocument()
    // The goal ETA moved earlier.
    expect(within(impact).getByText(/sooner\)/)).toBeInTheDocument()
    expect(within(impact).getByText('Car ETA')).toBeInTheDocument()
  })

  it('discards and exits through the footer actions', async () => {
    const onDiscard = vi.fn()
    const onExit = vi.fn()
    renderScreen([anUpdate], { onDiscard, onExit })
    await userEvent.click(screen.getByRole('button', { name: /discard changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /exit planning mode/i }))
    expect(onDiscard).toHaveBeenCalledOnce()
    expect(onExit).toHaveBeenCalledOnce()
  })
})
