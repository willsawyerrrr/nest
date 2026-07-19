import { describe, expect, it } from 'vitest'
import type { BudgetSummary, GroupSummary } from '@budget/plan'
import { render, screen, within } from '../test/render'
import { SummaryView } from './SummaryView'

const group = (fortnightlyCents: number, annualCents: number, portion: number): GroupSummary => ({
  fortnightlyCents,
  annualCents,
  portion,
})

const summary: BudgetSummary = {
  available: { fortnightlyCents: 500_000, annualCents: 13_000_000 },
  groups: {
    needs: group(200_000, 5_200_000, 0.4),
    wants: group(100_000, 2_600_000, 0.2),
    discretionary: group(50_000, 1_300_000, 0.1),
    temporary: group(25_000, 650_000, 0.05),
    savings: group(75_000, 1_950_000, 0.15),
    investments: group(25_000, 650_000, 0.05),
  },
  outgoings: { fortnightlyCents: 375_000, annualCents: 9_750_000 },
  savingsBlock: { fortnightlyCents: 100_000, annualCents: 2_600_000 },
  afterOutgoing: { fortnightlyCents: 125_000, annualCents: 3_250_000 },
  afterSaving: { fortnightlyCents: 25_000, annualCents: 650_000 },
}

describe('SummaryView', () => {
  it('renders available fortnightly and annual figures', () => {
    render(<SummaryView summary={summary} />)

    const card = screen.getByRole('region', { name: 'Available' })
    expect(within(card).getByText('$5,000.00')).toBeInTheDocument()
    expect(within(card).getByText('$130,000.00')).toBeInTheDocument()
    expect(within(card).getByText('100.0%')).toBeInTheDocument()
  })

  it('renders each group with fortnightly, annual, and portion', () => {
    render(<SummaryView summary={summary} />)

    const needs = screen.getByRole('region', { name: 'Needs' })
    expect(within(needs).getByText('$2,000.00')).toBeInTheDocument()
    expect(within(needs).getByText('$52,000.00')).toBeInTheDocument()
    expect(within(needs).getByText('40.0%')).toBeInTheDocument()

    const savings = screen.getByRole('region', { name: 'Savings' })
    expect(within(savings).getByText('$750.00')).toBeInTheDocument()
    expect(within(savings).getByText('$19,500.00')).toBeInTheDocument()
    expect(within(savings).getByText('15.0%')).toBeInTheDocument()

    for (const label of ['Wants', 'Discretionary', 'Temporary', 'Investments']) {
      expect(screen.getByRole('region', { name: label })).toBeInTheDocument()
    }
  })

  it('renders the allocation donut with a legend of each slice plus the buffer', () => {
    render(<SummaryView summary={summary} />)

    const donut = screen.getByRole('region', { name: 'Allocation' })
    expect(within(donut).getByText('Fortnightly allocation')).toBeInTheDocument()
    // Legend lists each non-empty group and the leftover buffer with its share.
    expect(within(donut).getByText('Needs')).toBeInTheDocument()
    expect(within(donut).getByText('Buffer')).toBeInTheDocument()
    expect(within(donut).getByText('40.0%')).toBeInTheDocument()
  })

  it('renders income, outgoing, and remaining totals within the allocation graph', () => {
    render(<SummaryView summary={summary} />)

    const donut = within(screen.getByRole('region', { name: 'Allocation' }))
    expect(donut.getByText('Income')).toBeInTheDocument()
    expect(donut.getByText('$5,000.00')).toBeInTheDocument()
    expect(donut.getByText('Outgoing')).toBeInTheDocument()
    expect(donut.getByText('$3,750.00')).toBeInTheDocument()
    expect(donut.getByText('Remaining')).toBeInTheDocument()
    expect(donut.getByText('$250.00')).toBeInTheDocument()
  })

  it('renders the running after-outgoing and after-saving figures', () => {
    render(<SummaryView summary={summary} />)

    const afterOutgoing = screen.getByRole('region', { name: 'After Outgoing' })
    expect(within(afterOutgoing).getByText('$1,250.00')).toBeInTheDocument()
    expect(within(afterOutgoing).getByText('$32,500.00')).toBeInTheDocument()
    expect(within(afterOutgoing).getByText('25.0%')).toBeInTheDocument()

    const afterSaving = screen.getByRole('region', { name: 'After Saving' })
    expect(within(afterSaving).getByText('$250.00')).toBeInTheDocument()
    expect(within(afterSaving).getByText('$6,500.00')).toBeInTheDocument()
    expect(within(afterSaving).getByText('5.0%')).toBeInTheDocument()
  })

  it('orders the savings-block groups after the after-outgoing line', () => {
    render(<SummaryView summary={summary} />)

    const order = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    const afterOutgoing = order.indexOf('After Outgoing')
    for (const label of ['Needs', 'Wants', 'Discretionary', 'Temporary']) {
      expect(order.indexOf(label)).toBeLessThan(afterOutgoing)
    }
    for (const label of ['Savings', 'Investments']) {
      expect(order.indexOf(label)).toBeGreaterThan(afterOutgoing)
    }
    expect(order.indexOf('After Saving')).toBeGreaterThan(order.indexOf('Investments'))
  })

  it('shows an empty state when there is nothing to reconcile', () => {
    const zero = { fortnightlyCents: 0, annualCents: 0 }
    const empty: BudgetSummary = {
      available: zero,
      groups: {
        needs: group(0, 0, 0),
        wants: group(0, 0, 0),
        discretionary: group(0, 0, 0),
        temporary: group(0, 0, 0),
        savings: group(0, 0, 0),
        investments: group(0, 0, 0),
      },
      outgoings: zero,
      savingsBlock: zero,
      afterOutgoing: zero,
      afterSaving: zero,
    }
    render(<SummaryView summary={empty} />)

    expect(screen.getByText(/nothing to reconcile yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
