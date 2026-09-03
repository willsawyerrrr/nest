import { useMediaQuery } from '@mantine/hooks'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetSummary, GroupSummary } from '@nest/plan'
import { planningStorageKey } from '../lib/planningMode'
import { render, screen, within } from '../test/render'
import { PlanningModeProvider } from './PlanningModeProvider'
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
  oneOffCents: 0,
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
  salarySacrifice: { fortnightlyCents: 50_000, annualCents: 1_300_000 },
}

describe('SummaryView', () => {
  it('shows a real → proposed move on the buffer while planning mode is active', () => {
    const baseline: BudgetSummary = {
      ...summary,
      afterSaving: { fortnightlyCents: 10_000, annualCents: 260_000 },
    }
    localStorage.setItem(planningStorageKey('h1'), JSON.stringify({ active: true, overrides: {} }))
    render(
      <PlanningModeProvider householdId="h1">
        <SummaryView summary={summary} baseline={baseline} />
      </PlanningModeProvider>,
    )
    const card = screen.getByRole('region', { name: 'After Saving' })
    // was $100.00 → now $250.00 (+$150.00)
    expect(within(card).getByText('$100.00')).toBeInTheDocument()
    expect(within(card).getByText('$250.00')).toBeInTheDocument()
    expect(within(card).getByText('(+$150.00)')).toBeInTheDocument()
  })

  it('stays a plain figure when a baseline is supplied but planning mode is off', () => {
    const baseline: BudgetSummary = {
      ...summary,
      afterSaving: { fortnightlyCents: 10_000, annualCents: 260_000 },
    }
    render(<SummaryView summary={summary} baseline={baseline} />)
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
  })

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

  it('omits the tax and salary-sacrifice slices and the gross ledger rows on take-home', () => {
    render(<SummaryView summary={summary} />)

    const donut = within(screen.getByRole('region', { name: 'Allocation' }))
    expect(donut.queryByText('Tax')).not.toBeInTheDocument()
    expect(donut.queryByText('Salary sacrifice')).not.toBeInTheDocument()
    // The three take-home tiles show, not the gross basis/tax/salary-sacrifice trio.
    expect(donut.getByText('Income')).toBeInTheDocument()
    // The ledger starts at Available with no Gross/Tax/Salary-sacrifice breakdown.
    expect(screen.queryByRole('region', { name: 'Gross' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Tax' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Salary sacrifice' })).not.toBeInTheDocument()
  })

  it('adds the tax and salary-sacrifice slices and keeps both tile sets on the gross basis', async () => {
    const user = userEvent.setup()
    render(<SummaryView summary={summary} />)

    await user.click(screen.getByRole('radio', { name: 'Gross' }))

    const donut = within(screen.getByRole('region', { name: 'Allocation' }))
    // The prepended pre-tax slices appear (Tax as both a legend row and a tile).
    expect(donut.getAllByText('Tax').length).toBeGreaterThanOrEqual(1)
    // Salary sacrifice shows as both a legend row and a tile.
    expect(donut.getAllByText('Salary sacrifice').length).toBeGreaterThanOrEqual(1)
    // The gross trio is added while the take-home tiles remain.
    expect(donut.getAllByText('Gross').length).toBeGreaterThanOrEqual(1)
    expect(donut.getByText('Income')).toBeInTheDocument()
    expect(donut.getByText('Outgoing')).toBeInTheDocument()
    expect(donut.getByText('Remaining')).toBeInTheDocument()
  })

  it('leads the ledger with a Gross subtotal and tax and salary-sacrifice deductions on the gross basis', async () => {
    const user = userEvent.setup()
    render(<SummaryView summary={summary} />)

    await user.click(screen.getByRole('radio', { name: 'Gross' }))

    // Gross basis = available 500_000 + tax 150_000 + salary sacrifice 50_000 = 700_000/fn.
    const gross = screen.getByRole('region', { name: 'Gross' })
    expect(within(gross).getByText('$7,000.00')).toBeInTheDocument()
    expect(within(gross).getByText('100.0%')).toBeInTheDocument()

    const tax = screen.getByRole('region', { name: 'Tax' })
    expect(within(tax).getByText('$1,500.00')).toBeInTheDocument()
    // Tax is 150_000 / 700_000 of gross.
    expect(within(tax).getByText('21.4%')).toBeInTheDocument()

    const sacrificeRow = screen.getByRole('region', { name: 'Salary sacrifice' })
    expect(within(sacrificeRow).getByText('$500.00')).toBeInTheDocument()

    // The ledger still runs from Available downward, now read as after-tax cash.
    const available = screen.getByRole('region', { name: 'Available' })
    // Available is 500_000 / 700_000 of gross.
    expect(within(available).getByText('71.4%')).toBeInTheDocument()
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
      oneOffCents: 0,
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
      salarySacrifice: zero,
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
      oneOffCents: 0,
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
      salarySacrifice: zero,
    }
    render(<SummaryView summary={noAvailable} />)

    const available = screen.getByRole('region', { name: 'Available' })
    expect(within(available).getByText('0.0%')).toBeInTheDocument()
  })

  it('shows an empty state when there is nothing to reconcile', () => {
    const zero = { fortnightlyCents: 0, annualCents: 0 }
    const empty: BudgetSummary = {
      oneOffCents: 0,
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
      salarySacrifice: zero,
    }
    render(<SummaryView summary={empty} />)

    expect(screen.getByText(/nothing to reconcile yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('reports one-off money beside the plan, saying it is left out of it', () => {
    render(<SummaryView summary={{ ...summary, oneOffCents: 40_000_00 }} />)
    const note = screen.getByText(/of one-off money lands this financial year/)
    expect(note).toHaveTextContent('$40,000.00')
    expect(note).toHaveTextContent(/left out of every figure above/)
  })

  it('says nothing about one-off money in a year that carries none', () => {
    render(<SummaryView summary={summary} />)
    expect(screen.queryByText(/of one-off money lands/)).not.toBeInTheDocument()
  })

  it('reconciles a year whose only money is a one-off, rather than reading as empty', () => {
    const zero = { fortnightlyCents: 0, annualCents: 0 }
    render(
      <SummaryView
        summary={{
          oneOffCents: 40_000_00,
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
          salarySacrifice: zero,
        }}
      />,
    )
    expect(screen.queryByText(/nothing to reconcile yet/i)).not.toBeInTheDocument()
    expect(screen.getByText(/of one-off money lands/)).toBeInTheDocument()
  })
})
