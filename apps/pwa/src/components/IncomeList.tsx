import type { Member } from '../hooks/useMembers'
import type { Income } from '../hooks/useIncomes'
import { formatCents } from '../lib/money'

interface IncomeListProps {
  incomes: Income[]
  members: Member[]
  onEdit: (income: Income) => void
  onDelete: (id: string) => void
}

/** Describes an income's entered amount: a flat amount, or a wage's rate × hours. */
function describeAmount(income: Income): string {
  if (income.type === 'wage') {
    const rate = formatCents(income.hourly_rate_cents ?? 0)
    return `${rate} × ${income.hours_per_period ?? 0} hrs`
  }
  return formatCents(income.amount_cents ?? 0)
}

/** Presentational list of the household's incomes with edit/delete controls. */
export function IncomeList({ incomes, members, onEdit, onDelete }: IncomeListProps) {
  const memberName = (id: string) => members.find((member) => member.id === id)?.name ?? 'Unknown'

  if (incomes.length === 0) {
    return <p>No incomes yet. Add one to get started.</p>
  }

  return (
    <ul className="income-list">
      {incomes.map((income) => (
        <li key={income.id}>
          <div>
            <strong>{income.name}</strong>
            <span>{memberName(income.member_id)}</span>
            <span>
              {income.type} · {income.schedule}
            </span>
            <span>{describeAmount(income)}</span>
          </div>
          <div className="income-list-actions">
            <button type="button" onClick={() => onEdit(income)}>
              Edit
            </button>
            <button type="button" onClick={() => onDelete(income.id)}>
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
