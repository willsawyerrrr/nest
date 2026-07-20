import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '../test/render'
import { InflowList } from './InflowList'
import type { Member } from '../hooks/useMembers'
import type { Inflow } from '../hooks/useInflows'

const members: Member[] = [
  {
    id: 'm1',
    household_id: 'h1',
    name: 'Will',
    email: null,
    user_id: 'u1',
    up_connected_at: null,
    created_at: '',
    updated_at: '',
  },
]

const base = {
  household_id: 'h1',
  interval_weeks: null,
  created_at: '',
  updated_at: '',
}

const salary: Inflow = {
  ...base,
  id: 'i1',
  member_id: 'm1',
  name: 'Day job',
  taxable: true,
  type: 'salary',
  schedule: 'fortnightly',
  amount_cents: 500000,
  hourly_rate_cents: null,
  hours_per_period: null,
}

const wage: Inflow = {
  ...base,
  id: 'i2',
  member_id: 'm1',
  name: 'Shifts',
  taxable: true,
  type: 'wage',
  schedule: 'weekly',
  amount_cents: null,
  hourly_rate_cents: 4500,
  hours_per_period: 38,
}

const reimbursement: Inflow = {
  ...base,
  id: 'i3',
  member_id: null,
  name: 'Travel',
  taxable: false,
  type: 'reimbursement',
  schedule: 'monthly',
  amount_cents: 8000,
  hourly_rate_cents: null,
  hours_per_period: null,
}

const everyNWeeks: Inflow = {
  ...base,
  id: 'i4',
  member_id: 'm1',
  name: 'Side gig',
  taxable: true,
  type: 'other',
  schedule: 'every_n_weeks',
  interval_weeks: 4,
  amount_cents: 20000,
  hourly_rate_cents: null,
  hours_per_period: null,
}

function renderList(inflows: Inflow[]) {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  const onUpdate = vi.fn().mockResolvedValue(undefined)
  const onDelete = vi.fn()
  render(
    <InflowList
      inflows={inflows}
      members={members}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />,
  )
  return { onCreate, onUpdate, onDelete }
}

describe('InflowList', () => {
  it('shows an empty message and an add button when there are no inflows', () => {
    renderList([])
    expect(screen.getByText(/no inflows yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add inflow/i })).toBeInTheDocument()
  })

  it('renders amounts and a taxable/non-taxable indicator per inflow', () => {
    renderList([salary, wage, reimbursement])

    // The entered amount shows per inflow, with a wage as its rate × hours.
    expect(screen.getAllByText('$5,000.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('$45.00 × 38 hrs')).toBeInTheDocument()
    expect(screen.getByText('$80.00')).toBeInTheDocument()
    expect(screen.getAllByText('Taxable')).toHaveLength(2)
    expect(screen.getByText('Non-taxable')).toBeInTheDocument()
    // The non-taxable inflow has no member tag, so only the taxable ones show a member.
    expect(screen.getAllByText('Will')).toHaveLength(2)
  })

  it('shows each inflow normalized to a fortnightly figure', () => {
    renderList([reimbursement])

    // Monthly $80 → annual $960 → $36.92/fn.
    expect(screen.getByText('$36.92')).toBeInTheDocument()
    expect(screen.getByText(/\/ fn/)).toBeInTheDocument()
  })

  it('renders an every-N-weeks schedule as a friendly label, not the raw enum', () => {
    renderList([everyNWeeks])

    expect(screen.getByText('Every 4 weeks')).toBeInTheDocument()
    expect(screen.queryByText(/every_n_weeks/i)).not.toBeInTheDocument()
  })

  it('renders each inflow as a dense borderless row on desktop', () => {
    // From `sm` up the inflow drops the bordered card for a single table-like row.
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
      renderList([wage])

      const name = screen.getByText('Shifts')
      expect(name.closest('.mantine-Card-root')).toBeNull()
      const row = name.closest('div')?.parentElement as HTMLElement
      expect(within(row).getByText('$45.00 × 38 hrs')).toBeInTheDocument()
      expect(within(row).getByText('Weekly')).toBeInTheDocument()
      expect(within(row).getByText('Will · Wage')).toBeInTheDocument()
      // Weekly $45 × 38 hrs = $1,710/wk → annual $88,920 → $3,420.00/fn.
      expect(within(row).getByText('$3,420.00')).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /edit/i })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /delete/i })).toBeInTheDocument()
    } finally {
      window.matchMedia = original
    }
  })

  it('renders the add button after the inflow cards', () => {
    renderList([salary, wage])

    const addButton = screen.getByRole('button', { name: /add inflow/i })
    const lastCard = screen.getByText('Shifts')
    // The add affordance sits below the list, so it follows the last card in the DOM.
    expect(lastCard.compareDocumentPosition(addButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('reveals an add form and creates on submit', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderList([salary])

    await user.click(screen.getByRole('button', { name: /add inflow/i }))
    await user.type(screen.getByLabelText(/name/i), 'Bonus')
    await user.type(screen.getByLabelText(/amount/i), '250')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bonus', taxable: true }),
      ),
    )
  })

  it('edits an inflow inline, in place of its card', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderList([salary])

    await user.click(screen.getByRole('button', { name: /edit/i }))
    // The display card is replaced by the inline form.
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('i1', expect.objectContaining({ name: 'Day job' })),
    )
  })

  it('cancels an inline edit and restores the card', async () => {
    const user = userEvent.setup()
    renderList([salary])

    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
  })

  it('invokes the delete callback', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderList([salary])

    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith('i1')
  })

  it('keeps only one card in edit mode, leaving the others displayed', async () => {
    const user = userEvent.setup()
    renderList([salary, wage])

    const firstEdit = screen.getAllByRole('button', { name: /^edit$/i }).at(0)
    if (!firstEdit) {
      throw new Error('expected an edit button')
    }
    await user.click(firstEdit)

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    // The other card stays in display mode with its own edit control.
    expect(screen.getAllByRole('button', { name: /^edit$/i })).toHaveLength(1)
    expect(screen.getByText('Shifts')).toBeInTheDocument()
  })
})
