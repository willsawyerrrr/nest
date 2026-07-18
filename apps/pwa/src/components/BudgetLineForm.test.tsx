import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '../test/render'
import { BudgetLineForm } from './BudgetLineForm'
import type { BudgetLine } from '../hooks/useBudgetLines'

/** Picks an option from a Mantine `Select` identified by its label. */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: string,
) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('BudgetLineForm', () => {
  it('submits a new line with dollars converted to cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BudgetLineForm defaultGroup="wants" onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Dining out')
    await user.type(screen.getByLabelText(/amount/i), '250.50')
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        line_group: 'wants',
        name: 'Dining out',
        amount_cents: 25050,
        frequency: 'fortnightly',
        goal_id: null,
      }),
    )
  })

  it('submits a savings line with a null goal', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BudgetLineForm onSubmit={onSubmit} />)

    await selectOption(user, /group/i, 'Savings')
    await user.type(screen.getByLabelText(/name/i), 'Emergency fund')
    await selectOption(user, /frequency/i, 'Monthly')
    await user.type(screen.getByLabelText(/amount/i), '400')
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        line_group: 'savings',
        name: 'Emergency fund',
        amount_cents: 40000,
        frequency: 'monthly',
        goal_id: null,
      }),
    )
  })

  it('disables submit until required fields are filled', async () => {
    const user = userEvent.setup()
    render(<BudgetLineForm onSubmit={vi.fn()} />)

    const button = screen.getByRole('button', { name: /add line/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/name/i), 'Rent')
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/amount/i), '1000')
    expect(button).toBeEnabled()
  })

  it('prefills fields from an existing line when editing', () => {
    const line: BudgetLine = {
      id: 'l1',
      household_id: 'h1',
      line_group: 'needs',
      name: 'Rent',
      amount_cents: 200000,
      frequency: 'monthly',
      goal_id: null,
      created_at: '',
      updated_at: '',
    }
    render(<BudgetLineForm initial={line} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('Rent')
    expect(screen.getByRole('combobox', { name: /group/i })).toHaveValue('Needs')
    expect(screen.getByLabelText(/amount/i)).toHaveValue('$2,000.00')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('preserves an existing line goal link on edit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const line: BudgetLine = {
      id: 'l1',
      household_id: 'h1',
      line_group: 'savings',
      name: 'House deposit',
      amount_cents: 50000,
      frequency: 'fortnightly',
      goal_id: 'g1',
      created_at: '',
      updated_at: '',
    }
    render(<BudgetLineForm initial={line} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ goal_id: 'g1' })),
    )
  })
})
