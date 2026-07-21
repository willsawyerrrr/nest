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
import type { Inflow, InflowInput, InflowType } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { Frequency } from '../lib/domain'
import { FREQUENCY_OPTIONS } from '../lib/frequency'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { EnumSelect } from './EnumSelect'

interface InflowFormProps {
  members: Member[]
  initial?: Inflow
  onSubmit: (input: InflowInput) => void | Promise<void>
  onCancel?: () => void
}

const TAXABLE_TYPES: { value: InflowType; label: string }[] = [
  { value: 'salary', label: 'Salary' },
  { value: 'wage', label: 'Wage' },
  { value: 'other', label: 'Other' },
]

const NON_TAXABLE_TYPES: { value: InflowType; label: string }[] = [
  { value: 'reimbursement', label: 'Reimbursement' },
  { value: 'hobby', label: 'Hobby income' },
  { value: 'gift', label: 'Gift' },
  { value: 'other', label: 'Other' },
]

/** The type a form defaults to for each taxability mode. */
const DEFAULT_TYPE = { taxable: 'salary', nonTaxable: 'reimbursement' } as const

/** The unit of one pay period, for labelling the gross amount by frequency. */
const PERIOD_NOUN: Record<Frequency, string> = {
  weekly: 'week',
  fortnightly: 'fortnight',
  monthly: 'month',
  quarterly: 'quarter',
  biannual: 'half-year',
  annual: 'year',
  every_n_weeks: 'payment',
  every_n_months: 'payment',
}

/** Presentational add/edit form for a single inflow. Persistence lives in the caller. */
export function InflowForm({ members, initial, onSubmit, onCancel }: InflowFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [taxable, setTaxable] = useState(initial?.taxable ?? true)
  const [memberId, setMemberId] = useState(initial?.member_id ?? members[0]?.id ?? '')
  const [type, setType] = useState<InflowType>(initial?.type ?? DEFAULT_TYPE.taxable)
  const [schedule, setSchedule] = useState<Frequency>(initial?.schedule ?? 'fortnightly')
  const [interval, setInterval] = useState<number | string>(initial?.interval_count ?? '')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [hourlyRate, setHourlyRate] = useState<number | string>(
    centsToDollars(initial?.hourly_rate_cents),
  )
  const [hours, setHours] = useState<number | string>(initial?.hours_per_period ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typeOptions = taxable ? TAXABLE_TYPES : NON_TAXABLE_TYPES

  /** Switches taxability, resetting the type to the new mode's default if it no longer applies. */
  const handleTaxableChange = (nextTaxable: boolean) => {
    setTaxable(nextTaxable)
    const options = nextTaxable ? TAXABLE_TYPES : NON_TAXABLE_TYPES
    if (!options.some((option) => option.value === type)) {
      setType(nextTaxable ? DEFAULT_TYPE.taxable : DEFAULT_TYPE.nonTaxable)
    }
  }

  const isWage = taxable && type === 'wage'
  const isEveryN = schedule === 'every_n_weeks' || schedule === 'every_n_months'
  const intervalUnit = schedule === 'every_n_months' ? 'months' : 'weeks'
  const intervalValid = Number.isInteger(Number(interval)) && Number(interval) >= 1
  const canSubmit =
    name.trim() !== '' &&
    (taxable ? memberId !== '' : true) &&
    (isWage ? hourlyRate !== '' && hours !== '' : amount !== '') &&
    (isEveryN ? interval !== '' && intervalValid : true) &&
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
      type,
      schedule,
      interval_count: isEveryN ? Number(interval) : null,
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
      <Stack gap="xs">
        <SegmentedControl
          fullWidth
          size="sm"
          aria-label="Taxability"
          value={taxable ? 'taxable' : 'nontaxable'}
          onChange={(value) => handleTaxableChange(value === 'taxable')}
          data={[
            { value: 'taxable', label: 'Taxable income' },
            { value: 'nontaxable', label: 'Non-taxable inflow' },
          ]}
        />

        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />

        {taxable && (
          <Select
            label="Member"
            size="sm"
            data={members.map((member) => ({ value: member.id, label: member.name }))}
            value={memberId}
            onChange={(value) => setMemberId(value ?? '')}
            allowDeselect={false}
          />
        )}

        <EnumSelect
          label="Type"
          size="sm"
          data={typeOptions}
          value={type}
          onChange={(value) => value && setType(value)}
          allowDeselect={false}
        />

        <EnumSelect
          label="Frequency"
          size="sm"
          description={
            <>
              How often you receive this amount. The app converts everything to{' '}
              <b>fortnightly and annual</b> regardless of your actual cycle. On an annual salary?
              Choose <b>Annually</b> and enter your yearly gross — even if you&apos;re paid
              fortnightly.
            </>
          }
          data={FREQUENCY_OPTIONS}
          value={schedule}
          onChange={(value) => value && setSchedule(value)}
          allowDeselect={false}
        />

        {isEveryN && (
          <NumberInput
            label={`${intervalUnit === 'months' ? 'Months' : 'Weeks'} between payments`}
            size="sm"
            description={`How many ${intervalUnit} apart each payment lands (e.g. 4 for once every four ${intervalUnit}).`}
            min={1}
            step={1}
            allowDecimal={false}
            hideControls
            value={interval}
            onChange={setInterval}
          />
        )}

        {isWage ? (
          <>
            <NumberInput
              label="Hourly rate"
              size="sm"
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
              size="sm"
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
            size="sm"
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
