import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

describe('IncomeForm', () => {
  it('submits a salary income with dollars converted to cents', async () => {
    const onSubmit = vi.fn()
    render(<IncomeForm members={members} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Day job' } })
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '1234.56' } })
    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

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
    const onSubmit = vi.fn()
    render(<IncomeForm members={members} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Shifts' } })
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'wage' } })
    fireEvent.change(screen.getByLabelText(/hourly rate/i), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText(/hours per period/i), { target: { value: '38' } })
    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

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

  it('disables submit until required fields are filled', () => {
    render(<IncomeForm members={members} onSubmit={vi.fn()} />)

    const button = screen.getByRole('button', { name: /add income/i })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Day job' } })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } })
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
    expect(screen.getByLabelText(/member/i)).toHaveValue('m2')
    expect(screen.getByLabelText(/amount/i)).toHaveValue(5000)
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('shows an error when saving fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<IncomeForm members={members} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Day job' } })
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
