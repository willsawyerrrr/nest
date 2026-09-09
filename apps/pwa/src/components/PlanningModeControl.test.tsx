import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { planningStorageKey, readPlanningMode, type PlanningState } from '../lib/planningMode'
import { render, screen } from '../test/render'
import { PlanningModeControl } from './PlanningModeControl'
import { PlanningModeProvider } from './PlanningModeProvider'

afterEach(() => localStorage.clear())

function renderControl() {
  return render(
    <PlanningModeProvider>
      <PlanningModeControl />
    </PlanningModeProvider>,
  )
}

function seed(state: PlanningState) {
  localStorage.setItem(planningStorageKey('h1'), JSON.stringify(state))
}

describe('PlanningModeControl', () => {
  it('is off by default and turns planning mode on', async () => {
    renderControl()
    const toggle = screen.getByRole('switch', { name: /planning mode/i })
    expect(toggle).not.toBeChecked()
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument()

    await userEvent.click(toggle)

    expect(toggle).toBeChecked()
    expect(readPlanningMode('h1').active).toBe(true)
  })

  it('shows the pending count and turns planning mode off', async () => {
    seed({
      active: true,
      overrides: { inflows: { updates: { a: { x: 1 } }, creates: [{ id: 'n' }], deletes: [] } },
    })
    renderControl()
    const toggle = screen.getByRole('switch', { name: /planning mode/i })
    expect(toggle).toBeChecked()
    expect(screen.getByText(/2 pending changes; turn off to discard/i)).toBeInTheDocument()

    await userEvent.click(toggle)

    expect(toggle).not.toBeChecked()
    expect(localStorage.getItem(planningStorageKey('h1'))).toBeNull()
  })

  it('phrases a single pending change in the singular', () => {
    seed({
      active: true,
      overrides: { inflows: { updates: {}, creates: [{ id: 'n' }], deletes: [] } },
    })
    renderControl()
    expect(screen.getByText(/1 pending change;/i)).toBeInTheDocument()
  })
})
