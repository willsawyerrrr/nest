import { useState, type FormEvent } from 'react'
import {
  Button,
  Card,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { Frequency, Inflow, InflowInput, InflowType } from '../hooks/useInflows'
import { centsToDollars, dollarsToCents } from '../lib/money'

interface InflowFormProps {
  members: Member[]
  initial?: Inflow
  onSubmit: (input: InflowInput) => void | Promise<void>
  onCancel?: () => void
}

const TYPES: { value: InflowType; label: string }[] = [
  { value: 'salary', label: 'Salary' },
  { value: 'wage', label: 'Wage' },
  { value: 'other', label: 'Other' },
]

const SCHEDULES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'biannual', label: 'Biannual' },
  { value: 'annual', label: 'Annual' },
]

/** The unit of one pay period, for labelling the gross amount by frequency. */
const PERIOD_NOUN: Record<Frequency, string> = {
  weekly: 'week',
  fortnightly: 'fortnight',
  monthly: 'month',
  quarterly: 'quarter',
  biannual: 'half-year',
  annual: 'year',
}

/** Presentational add/edit form for a single inflow. Persistence lives in the caller. */
export function InflowForm({ members, initial, onSubmit, onCancel }: InflowFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [taxable, setTaxable] = useState(initial?.taxable ?? true)
  const [memberId, setMemberId] = useState(initial?.member_id ?? members[0]?.id ?? '')
  const [type, setType] = useState<InflowType>(
    initial && initial.type !== 'reimbursement' ? initial.type : 'salary',
  )
  const [schedule, setSchedule] = useState<Frequency>(initial?.schedule ?? 'fortnightly')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [hourlyRate, setHourlyRate] = useState<number | string>(
    centsToDollars(initial?.hourly_rate_cents),
  )
  const [hours, setHours] = useState<number | string>(initial?.hours_per_period ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isWage = taxable && type === 'wage'
  const canSubmit =
    name.trim() !== '' &&
    (taxable ? memberId !== '' : true) &&
    (isWage ? hourlyRate !== '' && hours !== '' : amount !== '') &&
    !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    const input: InflowInput = {
      name: name.trim(),
      taxable,
      member_id: taxable ? memberId : null,
      type: taxable ? type : 'reimbursement',
      schedule,
      amount_cents: isWage ? null : dollarsToCents(amount),
      hourly_rate_cents: isWage ? dollarsToCents(hourlyRate) : null,
      hours_per_period: isWage ? (hours === '' ? null : Number(hours)) : null,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this inflow. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="sm">
        <SegmentedControl
          fullWidth
          aria-label="Taxability"
          value={taxable ? 'taxable' : 'nontaxable'}
          onChange={(value) => setTaxable(value === 'taxable')}
          data={[
            { value: 'taxable', label: 'Taxable income' },
            { value: 'nontaxable', label: 'Non-taxable inflow' },
          ]}
        />

        <TextInput
          label="Name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />

        {taxable && (
          <>
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
              onChange={(value) => value && setType(value as InflowType)}
              allowDeselect={false}
            />
          </>
        )}

        <Select
          label="Frequency"
          description={
            <>
              How often you receive this amount. The app converts everything to{' '}
              <b>fortnightly and annual</b> regardless of your actual cycle. On an annual salary?
              Choose <b>Annual</b> and enter your yearly gross — even if you&apos;re paid
              fortnightly.
            </>
          }
          data={SCHEDULES}
          value={schedule}
          onChange={(value) => value && setSchedule(value as Frequency)}
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
              fixedDecimalScale
              min={0}
              hideControls
              value={hourlyRate}
              onChange={setHourlyRate}
            />
            <NumberInput
              label="Hours per period"
              description="Hours worked each period. Gross = rate × hours × periods."
              min={0}
              decimalScale={2}
              hideControls
              value={hours}
              onChange={setHours}
            />
          </>
        ) : (
          <NumberInput
            label={`Amount per ${PERIOD_NOUN[schedule]}`}
            description={
              taxable
                ? 'Gross pay (before tax) for one period.'
                : 'Amount received each period; excluded from tax.'
            }
            prefix="$"
            thousandSeparator
            decimalScale={2}
            fixedDecimalScale
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
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add inflow'}
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
