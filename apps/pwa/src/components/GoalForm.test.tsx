import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '../test/render'
import { GoalForm } from './GoalForm'
import type { Goal } from '../hooks/useGoals'
import type { Saver } from '../hooks/useSavers'

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    household_id: 'h1',
    name: 'House deposit',
    target_amount_cents: 5_000_000,
    target_date: '2027-01-01',
    current_balance_cents: 1_000_000,
    linked_account_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function saver(overrides: Partial<Saver> = {}): Saver {
  return {
    id: 'a1',
    household_id: 'h1',
    owner_member_id: null,
    name: 'Up House Saver',
    type: 'savings',
    source: 'up',
    external_id: 'up-a1',
    balance_cents: 3_000_000,
    currency: 'AUD',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('GoalForm', () => {
  it('submits a new goal with dollars converted to cents and no target date', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<GoalForm savers={[]} onSubmit={onSubmit} />)

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
        linked_account_id: null,
      }),
    )
  })

  it('disables submit until name and target amount are filled', async () => {
    const user = userEvent.setup()
    render(<GoalForm savers={[]} onSubmit={vi.fn()} />)

    const button = screen.getByRole('button', { name: /add goal/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/name/i), 'Car')
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/target amount/i), '30000')
    expect(button).toBeEnabled()
  })

  it('prefills fields from an existing goal when editing', () => {
    render(<GoalForm initial={goal()} savers={[]} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('House deposit')
    expect(screen.getByLabelText(/target amount/i)).toHaveValue('$50,000.00')
    expect(screen.getByLabelText(/current balance/i)).toHaveValue('$10,000.00')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('hints to connect Up when there are no synced savers', () => {
    render(<GoalForm savers={[]} onSubmit={vi.fn()} />)

    expect(screen.getByText(/connect up and sync to link a saver/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/up saver/i)).toBeNull()
  })

  it('links a saver, hiding the manual balance and submitting the account id', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<GoalForm savers={[saver()]} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'House deposit')
    await user.type(screen.getByLabelText(/target amount/i), '50000')
    await user.click(screen.getByRole('combobox', { name: /up saver/i }))
    await user.click(await screen.findByRole('option', { name: 'Up House Saver' }))

    expect(screen.queryByLabelText(/current balance/i)).toBeNull()

    await user.click(screen.getByRole('button', { name: /add goal/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'House deposit',
        target_amount_cents: 5_000_000,
        target_date: null,
        current_balance_cents: 0,
        linked_account_id: 'a1',
      }),
    )
  })

  it('prefills the name from the saver when the name is empty', async () => {
    const user = userEvent.setup()
    render(<GoalForm savers={[saver()]} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('combobox', { name: /up saver/i }))
    await user.click(await screen.findByRole('option', { name: 'Up House Saver' }))

    expect(screen.getByLabelText(/name/i)).toHaveValue('Up House Saver')
  })

  it('keeps a name the user already typed when linking a saver', async () => {
    const user = userEvent.setup()
    render(<GoalForm savers={[saver()]} onSubmit={vi.fn()} />)

    await user.type(screen.getByLabelText(/name/i), 'House deposit')
    await user.click(screen.getByRole('combobox', { name: /up saver/i }))
    await user.click(await screen.findByRole('option', { name: 'Up House Saver' }))

    expect(screen.getByLabelText(/name/i)).toHaveValue('House deposit')
  })

  it('keeps the manual balance when no saver is linked', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<GoalForm savers={[saver()]} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Emergency fund')
    await user.type(screen.getByLabelText(/target amount/i), '10000')
    await user.type(screen.getByLabelText(/current balance/i), '2500')
    await user.click(screen.getByRole('button', { name: /add goal/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Emergency fund',
        target_amount_cents: 1_000_000,
        target_date: null,
        current_balance_cents: 250_000,
        linked_account_id: null,
      }),
    )
  })
})
