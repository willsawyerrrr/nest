import { useMediaQuery } from '@mantine/hooks'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetSummary, GroupSummary } from '@nest/plan'
import { render, screen, within } from '../test/render'
import { SummaryView } from './SummaryView'

vi.mock('@mantine/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/hooks')>()
  return { ...actual, useMediaQuery: vi.fn(() => false) }
})

beforeEach(() => {
  vi.mocked(useMediaQuery).mockReturnValue(false)
  // Reset the persisted income-basis toggle so each test starts on take-home.
  localStorage.clear()
})

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
  tax: { fortnightlyCents: 150_000, annualCents: 3_900_000 },
  superSaved: { fortnightlyCents: 50_000, annualCents: 1_300_000 },
}

describe('SummaryView', () => {
  it('renders available fortnightly and portion, omitting annual on the narrow ledger', () => {
    render(<SummaryView summary={summary} />)

    const card = screen.getByRole('region', { name: 'Available' })
    expect(within(card).getByText('$5,000.00')).toBeInTheDocument()
    expect(within(card).getByText('100.0%')).toBeInTheDocument()
    // The annual figure is dropped on the narrow ledger to keep the label untruncated.
    expect(within(card).queryByText('$130,000.00')).not.toBeInTheDocument()
  })

  it('renders each group with fortnightly and portion on the narrow ledger', () => {
    render(<SummaryView summary={summary} />)

    const needs = screen.getByRole('region', { name: 'Needs' })
    expect(within(needs).getByText('$2,000.00')).toBeInTheDocument()
    expect(within(needs).getByText('40.0%')).toBeInTheDocument()
    expect(within(needs).queryByText('$52,000.00')).not.toBeInTheDocument()

    const savings = screen.getByRole('region', { name: 'Savings' })
    expect(within(savings).getByText('$750.00')).toBeInTheDocument()
    expect(within(savings).getByText('15.0%')).toBeInTheDocument()
    expect(within(savings).queryByText('$19,500.00')).not.toBeInTheDocument()

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

  it('omits the tax and super slices on the default take-home basis', () => {
    render(<SummaryView summary={summary} />)

    const donut = within(screen.getByRole('region', { name: 'Allocation' }))
    expect(donut.queryByText('Tax')).not.toBeInTheDocument()
    expect(donut.queryByText('Salary-sacrifice super')).not.toBeInTheDocument()
    // The take-home tiles show, not the gross basis/tax/super ones.
    expect(donut.getByText('Income')).toBeInTheDocument()
    expect(donut.queryByText('Super')).not.toBeInTheDocument()
  })

  it('adds the tax and super slices and gross tiles on the gross basis', async () => {
    const user = userEvent.setup()
    render(<SummaryView summary={summary} />)

    await user.click(screen.getByRole('radio', { name: 'Gross' }))

    const donut = within(screen.getByRole('region', { name: 'Allocation' }))
    // The prepended pre-tax slices appear (Tax as both a legend row and a tile).
    expect(donut.getAllByText('Tax').length).toBeGreaterThanOrEqual(1)
    expect(donut.getByText('Salary-sacrifice super')).toBeInTheDocument()
    // The tiles switch to the gross basis, tax, and net super.
    expect(donut.getByText('Super')).toBeInTheDocument()
    expect(donut.queryByText('Income')).not.toBeInTheDocument()
    expect(donut.queryByText('Outgoing')).not.toBeInTheDocument()
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
    expect(within(afterOutgoing).getByText('25.0%')).toBeInTheDocument()
    expect(within(afterOutgoing).queryByText('$32,500.00')).not.toBeInTheDocument()

    const afterSaving = screen.getByRole('region', { name: 'After Saving' })
    expect(within(afterSaving).getByText('$250.00')).toBeInTheDocument()
    expect(within(afterSaving).getByText('5.0%')).toBeInTheDocument()
    expect(within(afterSaving).queryByText('$6,500.00')).not.toBeInTheDocument()
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

  it('renders the reconciliation table with running rows on wide screens', () => {
    vi.mocked(useMediaQuery).mockReturnValue(true)
    render(<SummaryView summary={summary} />)

    const table = screen.getByRole('table')
    // Running figures render as table rows in the wide layout, with the annual column.
    expect(within(table).getByRole('rowheader', { name: 'Available' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'After Outgoing' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'After Saving' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Needs' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Savings' })).toBeInTheDocument()
    // The annual figure appears in the wide table but not the narrow ledger.
    expect(within(table).getByText('$52,000.00')).toBeInTheDocument()
  })

  it('omits the allocation donut when nothing is allocated but there is still data', () => {
    const zero = { fortnightlyCents: 0, annualCents: 0 }
    const noAllocation: BudgetSummary = {
      available: { fortnightlyCents: 500_000, annualCents: 13_000_000 },
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
      afterOutgoing: { fortnightlyCents: 500_000, annualCents: 13_000_000 },
      afterSaving: zero,
      tax: zero,
      superSaved: zero,
    }
    render(<SummaryView summary={noAllocation} />)

    expect(screen.queryByRole('region', { name: 'Allocation' })).not.toBeInTheDocument()
    // The reconciliation rows still render.
    expect(screen.getByRole('region', { name: 'Available' })).toBeInTheDocument()
  })

  it('shows a zero portion when there is no available cash to divide by', () => {
    // Budget lines but no income: available is zero, so each running portion
    // takes the divide-by-zero guard and reads 0.0%.
    const zero = { fortnightlyCents: 0, annualCents: 0 }
    const negative = { fortnightlyCents: -375_000, annualCents: -9_750_000 }
    const noAvailable: BudgetSummary = {
      available: zero,
      groups: {
        needs: group(375_000, 9_750_000, 0),
        wants: group(0, 0, 0),
        discretionary: group(0, 0, 0),
        temporary: group(0, 0, 0),
        savings: group(0, 0, 0),
        investments: group(0, 0, 0),
      },
      outgoings: { fortnightlyCents: 375_000, annualCents: 9_750_000 },
      savingsBlock: zero,
      afterOutgoing: negative,
      afterSaving: negative,
      tax: zero,
      superSaved: zero,
    }
    render(<SummaryView summary={noAvailable} />)

    const available = screen.getByRole('region', { name: 'Available' })
    expect(within(available).getByText('0.0%')).toBeInTheDocument()
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
      tax: zero,
      superSaved: zero,
    }
    render(<SummaryView summary={empty} />)

    expect(screen.getByText(/nothing to reconcile yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
