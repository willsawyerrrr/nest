import { afterEach, describe, expect, it } from 'vitest'
import { PlanningModeProvider } from '../components/PlanningModeProvider'
import { render, screen } from '../test/render'
import { PlanningModeSection } from './PlanningModeSection'

afterEach(() => localStorage.clear())

describe('PlanningModeSection', () => {
  it('renders the planning-mode settings screen', () => {
    render(
      <PlanningModeProvider householdId="h1">
        <PlanningModeSection />
      </PlanningModeProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Planning mode' })).toBeInTheDocument()
  })
})
