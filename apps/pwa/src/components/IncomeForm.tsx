import { useState, type FormEvent } from 'react'
import type { Member } from '../hooks/useMembers'
import type { Income, IncomeInput, IncomeSchedule, IncomeType } from '../hooks/useIncomes'
import { centsToDollarInput, dollarsToCents } from '../lib/money'

interface IncomeFormProps {
  members: Member[]
  initial?: Income
  onSubmit: (input: IncomeInput) => void | Promise<void>
  onCancel?: () => void
}

const TYPES: IncomeType[] = ['salary', 'wage', 'other']
const SCHEDULES: IncomeSchedule[] = ['weekly', 'fortnightly', 'monthly', 'annual']

/** Presentational add/edit form for a single income. Persistence lives in the caller. */
export function IncomeForm({ members, initial, onSubmit, onCancel }: IncomeFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [memberId, setMemberId] = useState(initial?.member_id ?? members[0]?.id ?? '')
  const [type, setType] = useState<IncomeType>(initial?.type ?? 'salary')
  const [schedule, setSchedule] = useState<IncomeSchedule>(initial?.schedule ?? 'fortnightly')
  const [amount, setAmount] = useState(centsToDollarInput(initial?.amount_cents))
  const [hourlyRate, setHourlyRate] = useState(centsToDollarInput(initial?.hourly_rate_cents))
  const [hours, setHours] = useState(initial?.hours_per_period?.toString() ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isWage = type === 'wage'
  const canSubmit =
    name.trim() !== '' &&
    memberId !== '' &&
    (isWage ? hourlyRate.trim() !== '' && hours.trim() !== '' : amount.trim() !== '') &&
    !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    const input: IncomeInput = {
      name: name.trim(),
      member_id: memberId,
      type,
      schedule,
      amount_cents: isWage ? null : dollarsToCents(amount),
      hourly_rate_cents: isWage ? dollarsToCents(hourlyRate) : null,
      hours_per_period: isWage ? Number.parseFloat(hours) : null,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this income. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <form className="income-form" onSubmit={handleSubmit}>
      <label htmlFor="income-name">Name</label>
      <input id="income-name" value={name} onChange={(event) => setName(event.target.value)} />

      <label htmlFor="income-member">Member</label>
      <select
        id="income-member"
        value={memberId}
        onChange={(event) => setMemberId(event.target.value)}
      >
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>

      <label htmlFor="income-type">Type</label>
      <select
        id="income-type"
        value={type}
        onChange={(event) => setType(event.target.value as IncomeType)}
      >
        {TYPES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <label htmlFor="income-schedule">Schedule</label>
      <select
        id="income-schedule"
        value={schedule}
        onChange={(event) => setSchedule(event.target.value as IncomeSchedule)}
      >
        {SCHEDULES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      {isWage ? (
        <>
          <label htmlFor="income-hourly-rate">Hourly rate ($)</label>
          <input
            id="income-hourly-rate"
            type="number"
            min="0"
            step="0.01"
            value={hourlyRate}
            onChange={(event) => setHourlyRate(event.target.value)}
          />
          <label htmlFor="income-hours">Hours per period</label>
          <input
            id="income-hours"
            type="number"
            min="0"
            step="0.01"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
        </>
      ) : (
        <>
          <label htmlFor="income-amount">Amount ($)</label>
          <input
            id="income-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </>
      )}

      {error && <p role="alert">{error}</p>}

      <div className="income-form-actions">
        <button type="submit" disabled={!canSubmit}>
          {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add income'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
