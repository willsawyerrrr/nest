import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '../test/render'
import { BudgetLineList } from './BudgetLineList'
import type { BudgetLine } from '../hooks/useBudgetLines'

function line(overrides: Partial<BudgetLine>): BudgetLine {
  return {
    id: Math.random().toString(),
    household_id: 'h1',
    line_group: 'needs',
    name: 'Line',
    amount_cents: 10000,
    frequency: 'fortnightly',
    goal_id: null,
    derived_source: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

const lines: BudgetLine[] = [
  line({
    id: 'a',
    line_group: 'needs',
    name: 'Rent',
    amount_cents: 10000,
    frequency: 'fortnightly',
  }),
  line({ id: 'b', line_group: 'needs', name: 'Power', amount_cents: 5000, frequency: 'weekly' }),
  line({
    id: 'c',
    line_group: 'wants',
    name: 'Streaming',
    amount_cents: 3000,
    frequency: 'monthly',
  }),
]

describe('BudgetLineList', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('renders every group with a fortnightly subtotal', () => {
    render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    for (const label of ['Needs', 'Wants', 'Discretionary', 'Savings', 'Investments']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }

    // Rent $100/fn + Power $50/week ($100/fn) = $200.00/fn.
    expect(screen.getByLabelText('Needs fortnightly subtotal')).toHaveTextContent('$200.00 / fn')
    // Streaming $30/month → annual $360 → $13.85/fn.
    expect(screen.getByLabelText('Wants fortnightly subtotal')).toHaveTextContent('$13.85 / fn')
    expect(screen.getByLabelText('Savings fortnightly subtotal')).toHaveTextContent('$0.00 / fn')
  })

  it('groups each line under its group and shows its normalized fortnightly amount', () => {
    render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const power = screen.getByText('Power').closest('.mantine-Card-root') as HTMLElement
    expect(within(power).getByText('$50.00')).toBeInTheDocument()
    expect(within(power).getByText('Weekly')).toBeInTheDocument()
    expect(within(power).getByText('$100.00')).toBeInTheDocument()
  })

  it('shows an empty hint for a group with no lines', () => {
    render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/no investments lines yet/i)).toBeInTheDocument()
  })

  it('edits a line in place', async () => {
    const user = userEvent.setup()
    render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const rent = screen.getByText('Rent').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(rent).getByRole('button', { name: /edit/i }))

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toHaveValue('Rent')
  })

  it('opens a per-group add form scoped to that group', async () => {
    const user = userEvent.setup()
    render(
      <BudgetLineList
        lines={[]}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /add wants line/i }))

    expect(screen.getByRole('button', { name: /add line/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /group/i })).toHaveValue('Wants')
  })

  it('filters visible lines by name as the user searches', async () => {
    const user = userEvent.setup()
    render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('Search budget lines'), 'rent')

    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.queryByText('Power')).not.toBeInTheDocument()
    expect(screen.queryByText('Streaming')).not.toBeInTheDocument()
    // The group's subtotal stays computed over every line, not the filtered set.
    expect(screen.getByLabelText('Needs fortnightly subtotal')).toHaveTextContent('$200.00 / fn')
  })

  it('sorts the lines within a group by name', async () => {
    const user = userEvent.setup()
    render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    // Default order lists Power before Rent (Rent inserted first, then Power).
    const namesBefore = screen.getAllByText(/Rent|Power/).map((node) => node.textContent)
    expect(namesBefore).toEqual(['Rent', 'Power'])

    await user.click(screen.getByRole('combobox', { name: /sort by/i }))
    await user.click(screen.getByRole('option', { name: 'Name' }))

    const namesAfter = screen.getAllByText(/Rent|Power/).map((node) => node.textContent)
    expect(namesAfter).toEqual(['Power', 'Rent'])
  })

  it('persists the chosen sort across a remount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: /sort by/i }))
    await user.click(screen.getByRole('option', { name: 'Name' }))
    await user.click(screen.getByRole('button', { name: /toggle sort direction/i }))

    // Name descending lists Rent before Power within the Needs group.
    expect(screen.getAllByText(/Rent|Power/).map((node) => node.textContent)).toEqual([
      'Rent',
      'Power',
    ])

    unmount()
    render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: /sort by/i })).toHaveValue('Name')
    expect(screen.getAllByText(/Rent|Power/).map((node) => node.textContent)).toEqual([
      'Rent',
      'Power',
    ])
  })

  it('opens an unscoped add form via the universal Add item button', async () => {
    const user = userEvent.setup()
    render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Add item' }))

    expect(screen.getByRole('button', { name: /add line/i })).toBeInTheDocument()
    // Unlike the per-group button, it defaults to the first group, not a scoped one.
    expect(screen.getByRole('combobox', { name: /group/i })).toHaveValue('Needs')
  })
})
