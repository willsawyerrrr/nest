import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { Income, IncomeInput, IncomeSchedule, IncomeType } from '../hooks/useIncomes'
import { centsToDollars, dollarsToCents } from '../lib/money'

interface IncomeFormProps {
  members: Member[]
  initial?: Income
  onSubmit: (input: IncomeInput) => void | Promise<void>
  onCancel?: () => void
}

const TYPES: { value: IncomeType; label: string }[] = [
  { value: 'salary', label: 'Salary' },
  { value: 'wage', label: 'Wage' },
  { value: 'other', label: 'Other' },
]

const SCHEDULES: { value: IncomeSchedule; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
]

/** The unit of one pay period, for labelling the gross amount by schedule. */
const PERIOD_NOUN: Record<IncomeSchedule, string> = {
  weekly: 'week',
  fortnightly: 'fortnight',
  monthly: 'month',
  annual: 'year',
}

/** Presentational add/edit form for a single income. Persistence lives in the caller. */
export function IncomeForm({ members, initial, onSubmit, onCancel }: IncomeFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [memberId, setMemberId] = useState(initial?.member_id ?? members[0]?.id ?? '')
  const [type, setType] = useState<IncomeType>(initial?.type ?? 'salary')
  const [schedule, setSchedule] = useState<IncomeSchedule>(initial?.schedule ?? 'fortnightly')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [hourlyRate, setHourlyRate] = useState<number | string>(
    centsToDollars(initial?.hourly_rate_cents),
  )
  const [hours, setHours] = useState<number | string>(initial?.hours_per_period ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isWage = type === 'wage'
  const canSubmit =
    name.trim() !== '' &&
    memberId !== '' &&
    (isWage ? hourlyRate !== '' && hours !== '' : amount !== '') &&
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
      hours_per_period: isWage ? (hours === '' ? null : Number(hours)) : null,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this income. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="md" component="form" onSubmit={handleSubmit}>
      <Stack gap="md">
        <TextInput
          label="Name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />

        <Select
          label="Member"
          data={members.map((member) => ({ value: member.id, label: member.name }))}
          value={memberId}
          onChange={(value) => setMemberId(value ?? '')}
          allowDeselect={false}
        />

        <Select
          label="Type"
          data={TYPES}
          value={type}
          onChange={(value) => value && setType(value as IncomeType)}
          allowDeselect={false}
        />

        <Select
          label="Schedule"
          description={
            <>
              How often you receive this amount. The app converts everything to{' '}
              <b>fortnightly and annual</b> regardless of your actual pay cycle. On an annual
              salary? Choose <b>Annual</b> and enter your yearly gross — even if you&apos;re paid
              fortnightly.
            </>
          }
          data={SCHEDULES}
          value={schedule}
          onChange={(value) => value && setSchedule(value as IncomeSchedule)}
          allowDeselect={false}
        />

        {isWage ? (
          <>
            <NumberInput
              label="Hourly rate"
              description="Your gross (before tax) hourly pay rate."
              prefix="$"
              thousandSeparator
              decimalScale={2}
              min={0}
              hideControls
              value={hourlyRate}
              onChange={setHourlyRate}
            />
            <NumberInput
              label="Hours per period"
              description="Hours worked each pay period. Gross = rate × hours × pay periods."
              min={0}
              decimalScale={2}
              hideControls
              value={hours}
              onChange={setHours}
            />
          </>
        ) : (
          <NumberInput
            label={`Gross amount per ${PERIOD_NOUN[schedule]}`}
            description="Gross pay (before tax) for one pay period."
            prefix="$"
            thousandSeparator
            decimalScale={2}
            min={0}
            hideControls
            value={amount}
            onChange={setAmount}
          />
        )}

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add income'}
          </Button>
          {onCancel && (
            <Button type="button" variant="default" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  )
}
