import { fireEvent, render, screen } from '../test/render'
import { describe, expect, it, vi } from 'vitest'
import { IncomeList } from './IncomeList'
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
]

const base = {
  household_id: 'h1',
  member_id: 'm1',
  created_at: '',
  updated_at: '',
}

const salary: Income = {
  ...base,
  id: 'i1',
  name: 'Day job',
  type: 'salary',
  schedule: 'fortnightly',
  amount_cents: 500000,
  hourly_rate_cents: null,
  hours_per_period: null,
}

const wage: Income = {
  ...base,
  id: 'i2',
  name: 'Shifts',
  type: 'wage',
  schedule: 'weekly',
  amount_cents: null,
  hourly_rate_cents: 4500,
  hours_per_period: 38,
}

describe('IncomeList', () => {
  it('shows an empty message when there are no incomes', () => {
    render(<IncomeList incomes={[]} members={members} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText(/no incomes yet/i)).toBeInTheDocument()
  })

  it('renders the flat amount for salary and rate × hours for wage', () => {
    render(
      <IncomeList incomes={[salary, wage]} members={members} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )

    expect(screen.getByText('Day job')).toBeInTheDocument()
    expect(screen.getByText('$5,000.00')).toBeInTheDocument()
    expect(screen.getByText('Shifts')).toBeInTheDocument()
    expect(screen.getByText('$45.00 × 38 hrs')).toBeInTheDocument()
    expect(screen.getAllByText('Will')).toHaveLength(2)
  })

  it('invokes edit and delete callbacks', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(<IncomeList incomes={[salary]} members={members} onEdit={onEdit} onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(salary)

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith('i1')
  })
})
