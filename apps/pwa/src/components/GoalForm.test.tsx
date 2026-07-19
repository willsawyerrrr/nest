import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '../test/render'
import { GoalForm } from './GoalForm'
import type { Goal } from '../hooks/useGoals'

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    household_id: 'h1',
    name: 'House deposit',
    target_amount_cents: 5_000_000,
    target_date: '2027-01-01',
    current_balance_cents: 1_000_000,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('GoalForm', () => {
  it('submits a new goal with dollars converted to cents and no target date', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<GoalForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Emergency fund')
    await user.type(screen.getByLabelText(/target amount/i), '10000')
    await user.type(screen.getByLabelText(/current balance/i), '2500.50')
    await user.click(screen.getByRole('button', { name: /add goal/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Emergency fund',
        target_amount_cents: 1_000_000,
        target_date: null,
        current_balance_cents: 250_050,
      }),
    )
  })

  it('disables submit until name and target amount are filled', async () => {
    const user = userEvent.setup()
    render(<GoalForm onSubmit={vi.fn()} />)

    const button = screen.getByRole('button', { name: /add goal/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/name/i), 'Car')
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/target amount/i), '30000')
    expect(button).toBeEnabled()
  })

  it('prefills fields from an existing goal when editing', () => {
    render(<GoalForm initial={goal()} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('House deposit')
    expect(screen.getByLabelText(/target amount/i)).toHaveValue('$50,000.00')
    expect(screen.getByLabelText(/current balance/i)).toHaveValue('$10,000.00')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })
})
