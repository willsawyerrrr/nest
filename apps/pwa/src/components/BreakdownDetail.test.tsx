import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import type { Breakdown } from '../hooks/useBreakdowns'
import { render, screen, waitFor, within } from '../test/render'
import { BreakdownDetail } from './BreakdownDetail'

function breakdown(overrides: Partial<Breakdown> = {}): Breakdown {
  return {
    id: 'b1',
    household_id: 'h',
    name: 'Medications',
    line_group: 'needs',
    kind: 'generic',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function item(overrides: Partial<BreakdownItem> = {}): BreakdownItem {
  return {
    id: 'i1',
    household_id: 'h',
    breakdown_id: 'b1',
    name: 'Vitamin D',
    amount_cents: 10_00,
    frequency: 'monthly',
    interval_count: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function renderDetail(overrides: Partial<Parameters<typeof BreakdownDetail>[0]> = {}) {
  return render(
    <MemoryRouter>
      <BreakdownDetail
        breakdown={breakdown()}
        items={[item()]}
        backTo="/breakdowns"
        backLabel="Breakdowns"
        onUpdateBreakdown={vi.fn()}
        onDeleteBreakdown={vi.fn()}
        onCreateItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onDeleteItem={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  )
}

describe('BreakdownDetail', () => {
  it('shows each item with its fortnightly figure and the rolled-up total', () => {
    renderDetail()

    const card = screen.getByText('Vitamin D').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText('$10.00')).toBeInTheDocument()
    expect(within(card).getByText('Monthly')).toBeInTheDocument()
    // $10/month → $120/year → $4.62/fn.
    expect(screen.getByLabelText('Breakdown fortnightly total')).toHaveTextContent('$4.62 / fn')
    expect(screen.getByText(/rolls up to \$120\.00 \/ year/i)).toBeInTheDocument()
  })

  it('renders the back link to the given destination and label', () => {
    renderDetail({ backTo: '/budget', backLabel: 'Budget' })

    const link = screen.getByRole('link', { name: /budget/i })
    expect(link).toHaveAttribute('href', '/budget')
  })

  it('hides the settings card until Edit is toggled', async () => {
    const user = userEvent.setup()
    renderDetail()

    expect(
      screen.getByRole('button', { name: /delete breakdown/i, hidden: true }),
    ).not.toBeVisible()

    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    expect(screen.getByRole('button', { name: /delete breakdown/i })).toBeVisible()
  })

  it('adds an item', async () => {
    const user = userEvent.setup()
    const onCreateItem = vi.fn()
    renderDetail({ items: [], onCreateItem })

    await user.click(screen.getByRole('button', { name: 'Add item' }))
    // Scope to the item form: the breakdown settings also has a Name field.
    const form = screen.getByRole('button', { name: /add item/i }).closest('form') as HTMLElement
    await user.type(within(form).getByLabelText(/name/i), 'Fish oil')
    await user.type(within(form).getByLabelText(/amount/i), '15')
    await user.click(within(form).getByRole('button', { name: /add item/i }))

    await waitFor(() =>
      expect(onCreateItem).toHaveBeenCalledWith({
        name: 'Fish oil',
        amount_cents: 15_00,
        frequency: 'fortnightly',
        interval_count: null,
      }),
    )
  })

  it('renames the breakdown and changes its group', async () => {
    const user = userEvent.setup()
    const onUpdateBreakdown = vi.fn()
    renderDetail({ onUpdateBreakdown })

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const nameInput = screen.getByLabelText(/name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Health')
    await user.click(screen.getByRole('combobox', { name: /group/i }))
    await user.click(await screen.findByRole('option', { name: 'Wants' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onUpdateBreakdown).toHaveBeenCalledWith({ name: 'Health', line_group: 'wants' }),
    )
  })

  it('edits an item in place', async () => {
    const user = userEvent.setup()
    const onUpdateItem = vi.fn().mockResolvedValue(undefined)
    renderDetail({ onUpdateItem })

    await user.click(screen.getByRole('button', { name: /edit vitamin d/i }))
    const form = screen.getByRole('combobox', { name: /frequency/i }).closest('form') as HTMLElement
    const nameInput = within(form).getByLabelText(/name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Vitamin C')
    await user.click(within(form).getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onUpdateItem).toHaveBeenCalledWith(
        'i1',
        expect.objectContaining({ name: 'Vitamin C' }),
      ),
    )
  })

  it('deletes an item after confirming', async () => {
    const user = userEvent.setup()
    const onDeleteItem = vi.fn()
    renderDetail({ onDeleteItem })

    await user.click(screen.getByRole('button', { name: /delete vitamin d/i }))
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(onDeleteItem).toHaveBeenCalledWith('i1'))
  })

  it('deletes the breakdown after confirming', async () => {
    const user = userEvent.setup()
    const onDeleteBreakdown = vi.fn()
    renderDetail({ onDeleteBreakdown })

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByRole('button', { name: /delete breakdown/i }))
    // The confirm modal's Delete button.
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(onDeleteBreakdown).toHaveBeenCalledOnce())
  })
})
