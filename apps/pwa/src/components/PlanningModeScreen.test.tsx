import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { PlanningModeProvider } from './PlanningModeProvider'
import { PlanningModeScreen } from './PlanningModeScreen'

afterEach(() => localStorage.clear())

describe('PlanningModeScreen', () => {
  it('renders the page title and the planning-mode control', () => {
    render(
      <PlanningModeProvider householdId="h1">
        <PlanningModeScreen />
      </PlanningModeProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Planning mode' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /planning mode/i })).toBeInTheDocument()
  })
})
