import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { planningStorageKey, type PlanningState } from '../lib/planningMode'
import { render, screen } from '../test/render'
import { PlanningModeBanner } from './PlanningModeBanner'
import { PlanningModeProvider } from './PlanningModeProvider'

afterEach(() => localStorage.clear())

function seed(state: PlanningState) {
  localStorage.setItem(planningStorageKey('h1'), JSON.stringify(state))
}

function renderBanner(children: ReactNode = <PlanningModeBanner />) {
  return render(<PlanningModeProvider householdId="h1">{children}</PlanningModeProvider>)
}

describe('PlanningModeBanner', () => {
  it('renders nothing when planning mode is off', () => {
    renderBanner()
    expect(screen.queryByText('Planning mode')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /exit planning mode/i })).not.toBeInTheDocument()
  })

  it('names planning mode and warns that changes are not saved when on', () => {
    seed({ active: true, overrides: {} })
    renderBanner()
    expect(screen.getByText('Planning mode')).toBeInTheDocument()
    expect(
      screen.getByText(/changes to pays, bills, and savings goals aren’t saved/i),
    ).toBeVisible()
    expect(screen.queryByText(/pending change/)).not.toBeInTheDocument()
  })

  it('counts pending changes, singular and plural', () => {
    seed({
      active: true,
      overrides: { inflows: { updates: { a: { x: 1 } }, creates: [], deletes: [] } },
    })
    const { unmount } = renderBanner()
    expect(screen.getByText(/1 pending change(?!s)/)).toBeInTheDocument()
    unmount()

    seed({
      active: true,
      overrides: { inflows: { updates: { a: { x: 1 } }, creates: [], deletes: ['b'] } },
    })
    renderBanner()
    expect(screen.getByText(/2 pending changes/)).toBeInTheDocument()
  })

  it('exits planning mode from the Exit action', async () => {
    seed({ active: true, overrides: {} })
    renderBanner()
    await userEvent.click(screen.getByRole('button', { name: /exit planning mode/i }))
    expect(screen.queryByText('Planning mode')).not.toBeInTheDocument()
    expect(localStorage.getItem(planningStorageKey('h1'))).toBeNull()
  })
})
