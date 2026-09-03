import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { formatIsoDate } from '../lib/dates'
import { planningStorageKey } from '../lib/planningMode'
import { render, screen } from '../test/render'
import { ComparedAmount, ComparedDate } from './ComparedAmount'
import { PlanningModeProvider } from './PlanningModeProvider'

afterEach(() => localStorage.clear())

/** Renders `ui` with planning mode on or off. */
function renderWith(active: boolean, ui: ReactNode) {
  if (active) {
    localStorage.setItem(planningStorageKey('h1'), JSON.stringify({ active: true, overrides: {} }))
  }
  return render(<PlanningModeProvider householdId="h1">{ui}</PlanningModeProvider>)
}

describe('ComparedAmount', () => {
  it('renders a plain figure when planning mode is off, even if the numbers differ', () => {
    renderWith(false, <ComparedAmount baselineCents={10_000} proposedCents={25_000} />)
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.queryByText('$100.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })

  it('renders a plain figure when planning mode is on but the numbers are equal', () => {
    renderWith(true, <ComparedAmount baselineCents={25_000} proposedCents={25_000} />)
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })

  it('shows was → now with a signed increase delta', () => {
    const { container } = renderWith(
      true,
      <ComparedAmount baselineCents={10_000} proposedCents={25_000} />,
    )
    expect(screen.getByText('$100.00')).toBeInTheDocument()
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(container.textContent).toContain('(+$150.00)')
  })

  it('shows a decrease delta with a U+2212 minus', () => {
    renderWith(true, <ComparedAmount baselineCents={25_000} proposedCents={10_000} />)
    expect(screen.getByText('(−$150.00)')).toBeInTheDocument()
  })
})

describe('ComparedDate', () => {
  const june = formatIsoDate('2027-06-01')
  const mayEarly = formatIsoDate('2027-05-02')

  it('renders the plain date when planning mode is off', () => {
    renderWith(false, <ComparedDate baselineIso="2027-01-01" proposedIso="2027-06-01" />)
    expect(screen.getByText(june)).toBeInTheDocument()
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })

  it('renders the plain no-ETA label when there is no date', () => {
    renderWith(true, <ComparedDate baselineIso={null} proposedIso={null} />)
    expect(screen.getByText('no ETA')).toBeInTheDocument()
  })

  it('shows an earlier ETA as a "sooner" delta', () => {
    renderWith(true, <ComparedDate baselineIso="2027-06-01" proposedIso="2027-05-02" />)
    expect(screen.getByText(june)).toBeInTheDocument()
    expect(screen.getByText(mayEarly)).toBeInTheDocument()
    expect(screen.getByText('(30 days sooner)')).toBeInTheDocument()
  })

  it('shows a later ETA as a "later" delta and pluralises one day', () => {
    renderWith(true, <ComparedDate baselineIso="2027-05-01" proposedIso="2027-05-02" />)
    expect(screen.getByText('(1 day later)')).toBeInTheDocument()
  })

  it('omits the day count when one side has no date', () => {
    renderWith(true, <ComparedDate baselineIso={null} proposedIso="2027-05-02" />)
    expect(screen.getByText('no ETA')).toBeInTheDocument()
    expect(screen.getByText(mayEarly)).toBeInTheDocument()
    expect(screen.queryByText(/day/)).not.toBeInTheDocument()
  })

  it('takes the plain path when the two dates are equal', () => {
    renderWith(true, <ComparedDate baselineIso="2027-05-02" proposedIso="2027-05-02" />)
    expect(screen.getByText(mayEarly)).toBeInTheDocument()
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })
})
