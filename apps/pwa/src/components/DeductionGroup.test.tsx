import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionRow } from '../hooks/useDeductions'
import { render, screen, waitFor } from '../test/render'
import { DeductionGroup, DeductionGroupForm } from './DeductionGroup'

const member = { id: 'm1', name: 'Will' }

function makeGroup(overrides: Partial<DeductionGroupRow> = {}): DeductionGroupRow {
  return {
    id: 'g1',
    household_id: 'h1',
    member_id: 'm1',
    name: 'Adobe Creative Cloud',
    financial_year: 2027,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function makePayment(overrides: Partial<DeductionRow> = {}): DeductionRow {
  return {
    id: 'd1',
    household_id: 'h1',
    member_id: 'm1',
    description: 'Adobe Creative Cloud',
    amount_cents: 64_99,
    deduction_date: '2026-08-01',
    financial_year: 2027,
    basis: 'amount',
    distance_km: null,
    group_id: 'g1',
    full_amount_cents: 64_99,
    work_use_percent: 100,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('DeductionGroupForm', () => {
  it('submits the trimmed name for the member', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<DeductionGroupForm member={member} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Name'), '  Adobe Creative Cloud  ')
    await user.click(screen.getByRole('button', { name: /add group/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ member_id: 'm1', name: 'Adobe Creative Cloud' }),
    )
  })

  it('will not save a group with no name', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<DeductionGroupForm member={member} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Name'), '   ')
    await user.click(screen.getByRole('button', { name: /add group/i }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('prefills an existing group and cancels', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <DeductionGroupForm
        member={member}
        initial={makeGroup()}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByLabelText('Name')).toHaveValue('Adobe Creative Cloud')

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('DeductionGroup', () => {
  it('shows the name, the payment count, and the summed total', () => {
    render(
      <DeductionGroup
        group={makeGroup()}
        payments={[makePayment(), makePayment({ id: 'd2', amount_cents: 65_01 })]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      >
        <div />
      </DeductionGroup>,
    )

    expect(screen.getByText('Adobe Creative Cloud')).toBeInTheDocument()
    expect(screen.getByText('2 payments')).toBeInTheDocument()
    expect(screen.getByText('$130.00')).toBeInTheDocument()
  })

  it('counts a lone payment in the singular', () => {
    render(
      <DeductionGroup
        group={makeGroup()}
        payments={[makePayment()]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      >
        <div />
      </DeductionGroup>,
    )

    expect(screen.getByText('1 payment')).toBeInTheDocument()
  })

  it('totals an empty group at nothing', () => {
    render(
      <DeductionGroup group={makeGroup()} payments={[]} onEdit={vi.fn()} onDelete={vi.fn()}>
        <div />
      </DeductionGroup>,
    )

    expect(screen.getByText('0 payments')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('opens and closes the payments underneath', async () => {
    const user = userEvent.setup()
    render(
      <DeductionGroup
        group={makeGroup()}
        payments={[makePayment()]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      >
        <div>the payments</div>
      </DeductionGroup>,
    )

    const toggle = screen.getByRole('button', { name: /adobe creative cloud/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('offers edit and delete for the group itself', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <DeductionGroup group={makeGroup()} payments={[]} onEdit={onEdit} onDelete={onDelete}>
        <div />
      </DeductionGroup>,
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalled()
  })
})
