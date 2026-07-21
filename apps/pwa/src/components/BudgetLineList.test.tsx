import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, within } from '../test/render'
import { BudgetLineList } from './BudgetLineList'
import { makeBudgetLine as line } from '../test/fixtures'

const lines = [
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

  it('identifies each line’s route: the funding account, and the goal for savings', () => {
    render(
      <BudgetLineList
        lines={[
          line({ id: 'n', line_group: 'needs', name: 'Rent', destination_account_id: 'acc1' }),
          line({ id: 's', line_group: 'savings', name: 'Deposit saver', goal_id: 'g1' }),
        ]}
        goals={[{ id: 'g1', name: 'House deposit' }]}
        accounts={[{ id: 'acc1', name: 'Everyday' }]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const rent = screen.getByText('Rent').closest('.mantine-Card-root') as HTMLElement
    expect(within(rent).getByText('Everyday')).toBeInTheDocument()

    const deposit = screen.getByText('Deposit saver').closest('.mantine-Card-root') as HTMLElement
    expect(within(deposit).getByText('House deposit')).toBeInTheDocument()
  })

  it('uses an account/goal emoji as the route icon and strips it from the label', () => {
    render(
      <BudgetLineList
        lines={[
          line({ id: 'n', line_group: 'needs', name: 'Rent', destination_account_id: 'acc1' }),
          line({ id: 's', line_group: 'savings', name: 'Deposit saver', goal_id: 'g1' }),
        ]}
        goals={[{ id: 'g1', name: '🏦 House deposit' }]}
        accounts={[{ id: 'acc1', name: '🏖️ Holiday' }]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const rent = screen.getByText('Rent').closest('.mantine-Card-root') as HTMLElement
    expect(within(rent).getByText('Holiday')).toBeInTheDocument()
    expect(within(rent).queryByText('🏖️ Holiday')).not.toBeInTheDocument()

    const deposit = screen.getByText('Deposit saver').closest('.mantine-Card-root') as HTMLElement
    expect(within(deposit).getByText('House deposit')).toBeInTheDocument()
    expect(within(deposit).queryByText('🏦 House deposit')).not.toBeInTheDocument()
  })

  it('shows no route badge for an unrouted line', () => {
    render(
      <BudgetLineList
        lines={[line({ id: 'n', line_group: 'needs', name: 'Rent' })]}
        goals={[]}
        accounts={[{ id: 'acc1', name: 'Everyday' }]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const rent = screen.getByText('Rent').closest('.mantine-Card-root') as HTMLElement
    expect(within(rent).queryByText('Everyday')).not.toBeInTheDocument()
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

  it('offers the funding accounts when editing a line', async () => {
    const user = userEvent.setup()
    render(
      <BudgetLineList
        lines={lines}
        goals={[]}
        accounts={[{ id: 'acc1', name: 'Everyday' }]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const rent = screen.getByText('Rent').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(rent).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('combobox', { name: /funded from/i }))

    expect(await screen.findByRole('option', { name: 'Everyday' })).toBeInTheDocument()
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

    // The universal trigger stays put and the opened form adds its own submit button.
    expect(screen.getAllByRole('button', { name: 'Add line' })).toHaveLength(2)
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

  it('renders a derived line with an edit pencil beside its breakdown chevron', () => {
    render(
      <MemoryRouter>
        <BudgetLineList
          lines={[line({ id: 'g', line_group: 'wants', name: 'Presents', breakdown_id: 'b1' })]}
          goals={[]}
          breakdowns={[{ id: 'b1', name: 'Gifts', line_group: 'wants' }]}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onUpdateDerivedLine={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )
    const card = screen.getByText('Presents').closest('.mantine-Card-root') as HTMLElement
    // A chevron links through to the breakdown's editor.
    expect(within(card).getByRole('link', { name: /open breakdown/i })).toHaveAttribute(
      'href',
      '/breakdowns/b1',
    )
    // The breakdown chip is gone; the chevron and pencil are the affordances.
    expect(within(card).queryByText('Gifts')).not.toBeInTheDocument()
    // A derived line edits inline like a manual line, but never deletes from the budget.
    expect(within(card).getByRole('button', { name: /edit/i })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('opens the derived-line editor with the amount locked and no frequency input', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <BudgetLineList
          lines={[
            line({
              id: 'g',
              line_group: 'wants',
              name: 'Presents',
              amount_cents: 12000,
              frequency: 'annual',
              breakdown_id: 'b1',
            }),
          ]}
          goals={[]}
          accounts={[{ id: 'acc1', name: 'Everyday' }]}
          breakdowns={[{ id: 'b1', name: 'Gifts', line_group: 'wants' }]}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onUpdateDerivedLine={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))

    // The name seeds from the owning breakdown.
    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('Gifts')
    // The amount is breakdown-owned: linked out, never an editable input.
    expect(screen.queryByRole('spinbutton', { name: /amount/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /frequency/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit in breakdown/i })).toHaveAttribute(
      'href',
      '/breakdowns/b1',
    )
  })

  it('offers only the account-funded groups when editing a derived line', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <BudgetLineList
          lines={[line({ id: 'g', line_group: 'wants', name: 'Presents', breakdown_id: 'b1' })]}
          goals={[]}
          breakdowns={[{ id: 'b1', name: 'Gifts', line_group: 'wants' }]}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onUpdateDerivedLine={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('combobox', { name: /group/i }))

    expect(screen.getByRole('option', { name: 'Needs' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Discretionary' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Savings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Investments' })).not.toBeInTheDocument()
  })

  it('saves a derived line’s name, group, and funding account', async () => {
    const user = userEvent.setup()
    const onUpdateDerivedLine = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <BudgetLineList
          lines={[line({ id: 'g', line_group: 'wants', name: 'Presents', breakdown_id: 'b1' })]}
          goals={[]}
          accounts={[{ id: 'acc1', name: 'Everyday' }]}
          breakdowns={[{ id: 'b1', name: 'Gifts', line_group: 'wants' }]}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onUpdateDerivedLine={onUpdateDerivedLine}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))
    const nameInput = screen.getByRole('textbox', { name: /name/i })
    await user.clear(nameInput)
    await user.type(nameInput, 'Christmas gifts')
    await user.click(screen.getByRole('combobox', { name: /funded from/i }))
    await user.click(await screen.findByRole('option', { name: 'Everyday' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(onUpdateDerivedLine).toHaveBeenCalledWith('g', {
      name: 'Christmas gifts',
      line_group: 'wants',
      destination_account_id: 'acc1',
    })
  })

  it('renders each line as a dense borderless row on desktop', () => {
    // From `sm` up the line drops the bordered card for a single table-like row.
    const original = window.matchMedia
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('48em'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList) as typeof window.matchMedia
    try {
      render(
        <BudgetLineList
          lines={lines}
          goals={[]}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />,
      )

      const power = screen.getByText('Power')
      expect(power.closest('.mantine-Card-root')).toBeNull()
      const row = power.closest('div')?.parentElement as HTMLElement
      expect(within(row).getByText('$50.00')).toBeInTheDocument()
      expect(within(row).getByText('Weekly')).toBeInTheDocument()
      expect(within(row).getByText('$100.00')).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /edit/i })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /delete/i })).toBeInTheDocument()
    } finally {
      window.matchMedia = original
    }
  })

  it('opens an unscoped add form via the universal Add line button', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Add line' }))

    // The trigger stays put and the opened form adds its own submit button.
    expect(screen.getAllByRole('button', { name: 'Add line' })).toHaveLength(2)
    // Unlike the per-group button, it defaults to the first group, not a scoped one.
    expect(screen.getByRole('combobox', { name: /group/i })).toHaveValue('Needs')
  })
})
