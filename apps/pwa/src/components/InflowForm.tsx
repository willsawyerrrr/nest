import { useState } from 'react'
import { Group, NumberInput, SegmentedControl, Select, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Inflow, InflowInput, InflowType } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { Frequency } from '../lib/domain'
import { FREQUENCY_OPTIONS } from '../lib/frequency'
import { NON_TAXABLE_INFLOW_TYPE_OPTIONS, TAXABLE_INFLOW_TYPE_OPTIONS } from '../lib/inflowTypes'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { EnumSelect } from './EnumSelect'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface InflowFormProps {
  members: Member[]
  initial?: Inflow | undefined
  onSubmit: (input: InflowInput) => void | Promise<void>
  onCancel?: () => void
}

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
  const [startsOn, setStartsOn] = useState<string | null>(initial?.starts_on ?? null)
  const [endsOn, setEndsOn] = useState<string | null>(initial?.ends_on ?? null)

  const typeOptions = taxable ? TAXABLE_INFLOW_TYPE_OPTIONS : NON_TAXABLE_INFLOW_TYPE_OPTIONS

  /** Switches taxability, resetting the type to the new mode's default if it no longer applies. */
  const handleTaxableChange = (nextTaxable: boolean) => {
    setTaxable(nextTaxable)
    const options = nextTaxable ? TAXABLE_INFLOW_TYPE_OPTIONS : NON_TAXABLE_INFLOW_TYPE_OPTIONS
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
    (isEveryN ? interval !== '' && intervalValid : true)

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this inflow. Please try again.',
    onSubmit,
    buildInput: (): InflowInput => ({
      name: name.trim(),
      taxable,
      member_id: taxable ? memberId : null,
      type,
      schedule,
      interval_count: isEveryN ? Number(interval) : null,
      amount_cents: isWage ? null : dollarsToCents(amount),
      hourly_rate_cents: isWage ? dollarsToCents(hourlyRate) : null,
      hours_per_period: isWage ? (hours === '' ? null : Number(hours)) : null,
      starts_on: taxable ? startsOn : null,
      ends_on: taxable ? endsOn : null,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="inflow"
      onCancel={onCancel}
    >
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
          <MoneyInput
            label="Hourly rate"
            size="sm"
            description="Your gross (before tax) hourly pay rate."
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
        <MoneyInput
          label={`Amount per ${PERIOD_NOUN[schedule]}`}
          size="sm"
          description={
            taxable
              ? 'Gross pay (before tax) for one period.'
              : 'Amount received each period; excluded from tax.'
          }
          min={0}
          hideControls
          value={amount}
          onChange={setAmount}
        />
      )}

      {taxable && (
        <Group grow align="flex-start">
          <DateInput
            label="Effective from"
            size="sm"
            description="Leave blank if this income applies all year. To model a pay rise, set an end date and add a second inflow starting the next day."
            valueFormat="D MMM YYYY"
            clearable
            value={startsOn}
            onChange={setStartsOn}
          />
          <DateInput
            label="Effective until"
            size="sm"
            valueFormat="D MMM YYYY"
            clearable
            value={endsOn}
            onChange={setEndsOn}
          />
        </Group>
      )}
    </FormShell>
  )
}
