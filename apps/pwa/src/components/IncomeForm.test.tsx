import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '../test/render'
import { IncomeForm } from './IncomeForm'
import type { Member } from '../hooks/useMembers'
import type { Income } from '../hooks/useIncomes'

const members: Member[] = [
  {
    id: 'm1',
    household_id: 'h1',
    name: 'Will',
    email: null,
    user_id: 'u1',
    created_at: '',
    updated_at: '',
  },
  {
    id: 'm2',
    household_id: 'h1',
    name: 'Sam',
    email: null,
    user_id: 'u2',
    created_at: '',
    updated_at: '',
  },
]

/** Picks an option from a Mantine `Select` identified by its label. */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: string,
) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('IncomeForm', () => {
  it('submits a salary income with dollars converted to cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<IncomeForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount/i), '1234.56')
    await user.click(screen.getByRole('button', { name: /add income/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Day job',
        member_id: 'm1',
        type: 'salary',
        schedule: 'fortnightly',
        amount_cents: 123456,
        hourly_rate_cents: null,
        hours_per_period: null,
      }),
    )
  })

  it('submits a wage income with rate and hours', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<IncomeForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Shifts')
    await selectOption(user, /type/i, 'Wage')
    await user.type(screen.getByLabelText(/hourly rate/i), '45')
    await user.type(screen.getByLabelText(/hours per period/i), '38')
    await user.click(screen.getByRole('button', { name: /add income/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Shifts',
        member_id: 'm1',
        type: 'wage',
        schedule: 'fortnightly',
        amount_cents: null,
        hourly_rate_cents: 4500,
        hours_per_period: 38,
      }),
    )
  })

  it('disables submit until required fields are filled', async () => {
    const user = userEvent.setup()
    render(<IncomeForm members={members} onSubmit={vi.fn()} />)

    const button = screen.getByRole('button', { name: /add income/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/amount/i), '100')
    expect(button).toBeEnabled()
  })

  it('prefills fields from an existing income when editing', () => {
    const income: Income = {
      id: 'i1',
      household_id: 'h1',
      member_id: 'm2',
      name: 'Old job',
      type: 'salary',
      schedule: 'monthly',
      amount_cents: 500000,
      hourly_rate_cents: null,
      hours_per_period: null,
      created_at: '',
      updated_at: '',
    }
    render(<IncomeForm members={members} initial={income} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('Old job')
    expect(screen.getByRole('combobox', { name: /member/i })).toHaveValue('Sam')
    expect(screen.getByLabelText(/amount/i)).toHaveValue('$5,000')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<IncomeForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount/i), '100')
    await user.click(screen.getByRole('button', { name: /add income/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
