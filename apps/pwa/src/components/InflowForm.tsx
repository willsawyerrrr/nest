import { useState } from 'react'
import {
  Alert,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Switch,
  Text,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { annualCents, annualInflowGrossCents, periodsPerYear, perPeriodCents } from '@nest/plan'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Inflow, InflowInput, InflowType } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { Frequency } from '../lib/domain'
import { FREQUENCY_OPTIONS } from '../lib/frequency'
import {
  NON_TAXABLE_INFLOW_TYPE_OPTIONS,
  TAXABLE_INFLOW_TYPE_OPTIONS,
  TAXABLE_ONE_OFF_TYPE_OPTIONS,
} from '../lib/inflowTypes'
import { centsToDollars, dollarsToCents, formatCents } from '../lib/money'
import {
  EMPTY_ONE_OFF_DRAFT,
  isOneOffDraftComplete,
  oneOffDraftFrom,
  oneOffRecurrenceInput,
  RECURRING_RECURRENCE_INPUT,
} from '../lib/oneOffInflow'
import { EnumSelect } from './EnumSelect'
import { FormShell } from './FormShell'
import { InflowOneOffFields } from './InflowOneOffFields'
import { MoneyInput } from './MoneyInput'

interface InflowFormProps {
  members: Member[]
  initial?: Inflow | undefined
  onSubmit: (input: InflowInput) => void | Promise<void>
  onCancel?: () => void
}

/** The type a form defaults to for each taxability mode. */
const DEFAULT_TYPE = { taxable: 'salary', nonTaxable: 'reimbursement' } as const

/**
 * The unit of one period of a frequency, for labelling the amount that covers it. The
 * arbitrary cadences have no name of their own, their length being whatever interval
 * is given, so they read as a plain period.
 */
const PERIOD_NOUN: Record<Frequency, string> = {
  weekly: 'week',
  fortnightly: 'fortnight',
  monthly: 'month',
  quarterly: 'quarter',
  biannual: 'half-year',
  annual: 'year',
  every_n_weeks: 'period',
  every_n_months: 'period',
}

/** The "arrives on the amount's own frequency" choice, the pay-cadence picker's default. */
const SAME_CADENCE = 'same'

/**
 * Pay-cadence options: the amount's own frequency first, then every cadence money can
 * land on. Picking the first stores no pay cadence at all, which is what says the two
 * are the same.
 */
const PAY_CADENCE_OPTIONS: { value: Frequency | typeof SAME_CADENCE; label: string }[] = [
  { value: SAME_CADENCE, label: 'Same as above' },
  ...FREQUENCY_OPTIONS,
]

/** Whether a frequency needs an interval count to say how long one of its periods runs. */
function needsInterval(frequency: Frequency | null): boolean {
  return frequency === 'every_n_weeks' || frequency === 'every_n_months'
}

/** Whether `interval` is a usable interval count, as the database's checks require. */
function isIntervalValid(interval: number | string): boolean {
  return Number.isInteger(Number(interval)) && Number(interval) >= 1
}

/** What one payment comes to, and how a year of them compares with the amount stated. */
interface PerPayment {
  /** The amount landing in one payment — the figure a payslip's period is measured against. */
  readonly cents: number
  /** What a year of those payments comes to, rounding included. */
  readonly annualCents: number
  /** The annual total the amount itself states. */
  readonly statedAnnualCents: number
  /** The unit one payment covers, for labelling. */
  readonly noun: string
}

/**
 * What one payment of `annualAmountCents` comes to on the pay cadence, or null when
 * there is nothing to derive: no separate pay cadence, one whose interval is not yet
 * given, or one landing as often as the amount is expressed, where the payment simply
 * is the amount. Nothing here is stored — the row keeps the amount and its own
 * frequency untouched — so this is the very division the payslip expectation makes,
 * shown ahead of it.
 */
function describePerPayment(
  annualAmountCents: number | null,
  amountFrequency: Frequency,
  amountInterval: number | undefined,
  payFrequency: Frequency | null,
  payInterval: number | undefined,
): PerPayment | null {
  if (annualAmountCents === null || payFrequency === null) {
    return null
  }
  const payPeriods = periodsPerYear(payFrequency, payInterval)
  if (payPeriods === 0 || payPeriods === periodsPerYear(amountFrequency, amountInterval)) {
    return null
  }
  const cents = perPeriodCents(annualAmountCents, payFrequency, payInterval)
  return {
    cents,
    annualCents: annualCents(cents, payFrequency, payInterval),
    statedAnnualCents: annualAmountCents,
    // On an arbitrary cadence one turn is only ever "a payment"; every fixed cadence
    // has a name of its own.
    noun: needsInterval(payFrequency) ? 'payment' : PERIOD_NOUN[payFrequency],
  }
}

/**
 * What one payment works out to, shown under the pay cadence that divides it. This is
 * the figure a payslip for one whole pay period is held against, so showing it here is
 * what makes the two agree in advance. Each payment rounds to the nearest cent on its
 * own, so a year of them can land either side of the annual figure the amount states;
 * where it does the gap is named, rather than left to be discovered on a slip.
 *
 * Money arriving in only some pay periods has no such figure — no slip is held
 * against one — so the note is not shown for it at all rather than stating a share
 * nothing expects.
 */
function PerPaymentNote({ perPayment }: { perPayment: PerPayment }) {
  const gap = perPayment.annualCents - perPayment.statedAnnualCents
  return (
    <Text size="xs" c="dimmed">
      That is {formatCents(perPayment.cents)} each {perPayment.noun}.
      {gap !== 0 &&
        ` A year of those payments comes to ${formatCents(perPayment.annualCents)}, ${formatCents(
          Math.abs(gap),
        )} ${gap < 0 ? 'under' : 'over'} the ${formatCents(
          perPayment.statedAnnualCents,
        )} stated, because each payment rounds to the nearest cent.`}
    </Text>
  )
}

/**
 * Advice for a salary or wage whose money arrives once a year, which is rarely what is
 * meant: a yearly figure says so through its own frequency, without the pay cycle
 * having to claim it too. Advice alone — it never blocks a save, because someone paid
 * once a year exists.
 */
function AnnualArrivalNote() {
  return (
    <Alert color="warning" variant="light" p="xs">
      <Text size="xs">
        This says the money arrives once a year. If a yearly figure is paid more often than that,
        set <b>Paid</b> to the cycle it lands on — the amount above stays the yearly one.
      </Text>
    </Alert>
  )
}

/** Presentational add/edit form for a single inflow. Persistence lives in the caller. */
export function InflowForm({ members, initial, onSubmit, onCancel }: InflowFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [taxable, setTaxable] = useState(initial?.taxable ?? true)
  const [attractsSuper, setAttractsSuper] = useState(initial?.attracts_super ?? true)
  const [memberId, setMemberId] = useState(initial?.member_id ?? members[0]?.id ?? '')
  const [type, setType] = useState<InflowType>(initial?.type ?? DEFAULT_TYPE.taxable)
  const [schedule, setSchedule] = useState<Frequency>(initial?.schedule ?? 'fortnightly')
  const [interval, setInterval] = useState<number | string>(initial?.interval_count ?? '')
  const [paySchedule, setPaySchedule] = useState<Frequency | null>(initial?.pay_schedule ?? null)
  const [payInterval, setPayInterval] = useState<number | string>(initial?.pay_interval_count ?? '')
  const [arrivesEveryPeriod, setArrivesEveryPeriod] = useState(
    initial?.arrives_every_pay_period ?? true,
  )
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [hourlyRate, setHourlyRate] = useState<number | string>(
    centsToDollars(initial?.hourly_rate_cents),
  )
  const [hours, setHours] = useState<number | string>(initial?.hours_per_period ?? '')
  const [startsOn, setStartsOn] = useState<string | null>(initial?.starts_on ?? null)
  const [endsOn, setEndsOn] = useState<string | null>(initial?.ends_on ?? null)
  const [oneOff, setOneOff] = useState(
    initial === undefined ? EMPTY_ONE_OFF_DRAFT : oneOffDraftFrom(initial),
  )
  const [isOneOff, setIsOneOff] = useState(initial?.paid_on != null)
  const [isJoint, setIsJoint] = useState(initial?.is_joint ?? false)
  const [splitPercent, setSplitPercent] = useState<number | string>(
    initial?.member_split_percent ?? 50,
  )

  const typeOptions = taxable
    ? isOneOff
      ? TAXABLE_ONE_OFF_TYPE_OPTIONS
      : TAXABLE_INFLOW_TYPE_OPTIONS
    : NON_TAXABLE_INFLOW_TYPE_OPTIONS

  /**
   * Only a recurring taxable `other` inflow can be joint, so any move off that —
   * a type change, switching to a one-off, or dropping taxability — clears the
   * joint choice rather than leaving it to reappear if the inflow returns to
   * `other`.
   */
  const clearJointIfIneligible = (
    nextTaxable: boolean,
    nextType: InflowType,
    nextIsOneOff: boolean,
  ) => {
    if (!(nextTaxable && nextType === 'other' && !nextIsOneOff)) {
      setIsJoint(false)
    }
  }

  /** Switches taxability, resetting the type to the new mode's default if it no longer applies. */
  const handleTaxableChange = (nextTaxable: boolean) => {
    setTaxable(nextTaxable)
    const options = nextTaxable ? TAXABLE_INFLOW_TYPE_OPTIONS : NON_TAXABLE_INFLOW_TYPE_OPTIONS
    const nextType = options.some((option) => option.value === type)
      ? type
      : nextTaxable
        ? DEFAULT_TYPE.taxable
        : DEFAULT_TYPE.nonTaxable
    setType(nextType)
    clearJointIfIneligible(nextTaxable, nextType, isOneOff)
  }

  /** Switches the inflow type, clearing the joint choice when it is no longer `other`. */
  const handleTypeChange = (nextType: InflowType) => {
    setType(nextType)
    clearJointIfIneligible(taxable, nextType, isOneOff)
  }

  /**
   * Switches recurrence. A one-off is never a `wage` — an amount paid once prices no
   * hours — so a wage becomes a salary on the way in, and stays one on the way back
   * out rather than silently reviving a rate and hours that were never re-entered.
   */
  const handleRecurrenceChange = (nextIsOneOff: boolean) => {
    setIsOneOff(nextIsOneOff)
    if (nextIsOneOff && type === 'wage') {
      setType(DEFAULT_TYPE.taxable)
    }
    clearJointIfIneligible(taxable, type, nextIsOneOff)
  }

  const isWage = !isOneOff && taxable && type === 'wage'
  // Everything a cadence needs is a recurring inflow's alone: a one-off has no
  // interval, no separate pay cadence, no effective window, and no turn of a cycle to
  // arrive in, so each is held at the nothing the database's one-off shape requires.
  const isEveryN = !isOneOff && needsInterval(schedule)
  const intervalUnit = schedule === 'every_n_months' ? 'months' : 'weeks'
  const intervalValid = isIntervalValid(interval)
  const intervalCount = isEveryN && intervalValid ? Number(interval) : undefined
  // The pay cadence is a taxable-inflow concern: it exists to line a payslip's period
  // up with the projection, and only taxable inflows are reconciled against payslips.
  const payCadence = taxable && !isOneOff ? paySchedule : null
  const isPayEveryN = needsInterval(payCadence)
  const payIntervalUnit = payCadence === 'every_n_months' ? 'months' : 'weeks'
  const payIntervalValid = isIntervalValid(payInterval)
  const payIntervalCount = isPayEveryN && payIntervalValid ? Number(payInterval) : undefined
  // Whether the money lands every period is a taxable-inflow concern for the same
  // reason the pay cadence is: it exists to keep a payslip period from expecting pay
  // that only lands in some, and only a taxable inflow is reconciled against a slip.
  const arrivesEvery = taxable && !isOneOff ? arrivesEveryPeriod : true
  const amountEntered = isWage ? hourlyRate !== '' && hours !== '' : amount !== ''

  // Only a recurring taxable `other` inflow — joint interest, jointly-held
  // dividends, a jointly-owned rental — can be split between both partners.
  const jointEligible = !isOneOff && taxable && type === 'other'
  const joint = jointEligible && isJoint
  const splitPercentNum = Number(splitPercent)
  const splitPercentValid =
    Number.isInteger(splitPercentNum) && splitPercentNum >= 0 && splitPercentNum <= 100
  const primaryMemberName = members.find((member) => member.id === memberId)?.name ?? 'this member'
  const otherMemberName =
    members.find((member) => member.id !== memberId)?.name ?? 'the other member'

  // The annual total the amount states, by the very arithmetic the payslip expectation
  // annualises with, so the derived per-payment figure shown below is the one a slip
  // will be measured against.
  const statedAnnualCents = amountEntered
    ? annualInflowGrossCents({
        type: isWage ? 'wage' : 'other',
        schedule,
        ...(intervalCount !== undefined && { interval: intervalCount }),
        ...(isWage
          ? {
              hourlyRateCents: dollarsToCents(hourlyRate) ?? 0,
              hoursPerPeriod: Number(hours),
            }
          : { amountCents: dollarsToCents(amount) ?? 0 }),
      })
    : null
  const perPayment = describePerPayment(
    statedAnnualCents,
    schedule,
    intervalCount,
    payCadence,
    payIntervalCount,
  )

  // Money arriving once a year is rarely what a salary or wage means, and a yearly
  // amount says what it is through its own frequency rather than through the pay cycle.
  // A one-off says the same thing honestly, so the advice has nothing to add there.
  const arrivesAnnually =
    !isOneOff &&
    taxable &&
    (type === 'salary' || type === 'wage') &&
    (payCadence ?? schedule) === 'annual'

  const canSubmit =
    name.trim() !== '' &&
    (taxable ? memberId !== '' : true) &&
    amountEntered &&
    (isOneOff
      ? isOneOffDraftComplete(oneOff, taxable)
      : (isEveryN ? interval !== '' && intervalValid : true) &&
        (isPayEveryN ? payInterval !== '' && payIntervalValid : true) &&
        (joint ? splitPercent !== '' && splitPercentValid : true))

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this inflow. Please try again.',
    onSubmit,
    buildInput: (): InflowInput => ({
      name: name.trim(),
      taxable,
      member_id: taxable ? memberId : null,
      type,
      // Only a taxable inflow is ever part of an employer's super base; a
      // non-taxable one is stored as ordinary time earnings so switching it back
      // to taxable starts from the ordinary default. A one-off is stored the same
      // way, no employer super accruing on money that lands once.
      attracts_super: taxable && !isOneOff ? attractsSuper : true,
      schedule: isOneOff ? null : schedule,
      interval_count: isEveryN ? Number(interval) : null,
      pay_schedule: payCadence,
      pay_interval_count: isPayEveryN ? Number(payInterval) : null,
      arrives_every_pay_period: arrivesEvery,
      amount_cents: isWage ? null : dollarsToCents(amount),
      hourly_rate_cents: isWage ? dollarsToCents(hourlyRate) : null,
      hours_per_period: isWage ? (hours === '' ? null : Number(hours)) : null,
      starts_on: isOneOff ? null : startsOn,
      ends_on: isOneOff ? null : endsOn,
      // Joint applies only to a recurring taxable `other` inflow; anything else
      // stores neither field, and the database's `inflows_joint_split` check
      // holds the same rule.
      is_joint: joint,
      member_split_percent: joint ? splitPercentNum : null,
      ...(isOneOff ? oneOffRecurrenceInput(oneOff, taxable) : RECURRING_RECURRENCE_INPUT),
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
        onChange={(value) => value && handleTypeChange(value)}
        allowDeselect={false}
      />

      <SegmentedControl
        fullWidth
        size="sm"
        aria-label="Recurrence"
        value={isOneOff ? 'oneoff' : 'recurring'}
        onChange={(value) => handleRecurrenceChange(value === 'oneoff')}
        data={[
          { value: 'recurring', label: 'Recurring' },
          { value: 'oneoff', label: 'One-off' },
        ]}
      />

      {!isOneOff && (
        <EnumSelect
          label="Frequency"
          size="sm"
          description={
            <>
              The period the figure below covers. A salary defined as a yearly number is{' '}
              <b>Annually</b> here however often it is paid — say the pay cycle under <b>Paid</b>.
              The app converts everything to <b>fortnightly and annual</b>.
            </>
          }
          data={FREQUENCY_OPTIONS}
          value={schedule}
          onChange={(value) => value && setSchedule(value)}
          allowDeselect={false}
        />
      )}

      {isEveryN && (
        <NumberInput
          label={`${intervalUnit === 'months' ? 'Months' : 'Weeks'} in a period`}
          size="sm"
          description={`How many ${intervalUnit} the figure below covers (e.g. 4 for an amount received every four ${intervalUnit}).`}
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
            label={`Hours per ${PERIOD_NOUN[schedule]}`}
            size="sm"
            description="Hours worked over that period. Gross = rate × hours × periods."
            min={0}
            decimalScale={2}
            hideControls
            value={hours}
            onChange={setHours}
          />
        </>
      ) : (
        <MoneyInput
          label={isOneOff ? 'Amount' : `Amount per ${PERIOD_NOUN[schedule]}`}
          size="sm"
          description={
            isOneOff
              ? taxable
                ? 'Gross amount (before tax) of this single payment.'
                : 'Amount received in this single payment; excluded from tax.'
              : taxable
                ? 'Gross pay (before tax) for one such period.'
                : 'Amount received over one such period; excluded from tax.'
          }
          min={0}
          hideControls
          value={amount}
          onChange={setAmount}
        />
      )}

      {isOneOff && (
        <InflowOneOffFields
          taxable={taxable}
          amountCents={dollarsToCents(amount)}
          member={members.find((each) => each.id === memberId)}
          draft={oneOff}
          onChange={setOneOff}
        />
      )}

      {taxable && !isOneOff && (
        <EnumSelect
          label="Paid"
          size="sm"
          description="How often the money actually arrives, when that is not the period above. A yearly salary paid fortnightly is Annually above and Fortnightly here."
          data={PAY_CADENCE_OPTIONS}
          value={paySchedule ?? SAME_CADENCE}
          onChange={(value) => value && setPaySchedule(value === SAME_CADENCE ? null : value)}
          allowDeselect={false}
        />
      )}

      {isPayEveryN && (
        <NumberInput
          label={`${payIntervalUnit === 'months' ? 'Months' : 'Weeks'} between payments`}
          size="sm"
          description={`How many ${payIntervalUnit} apart each payment lands (e.g. 4 for once every four ${payIntervalUnit}).`}
          min={1}
          step={1}
          allowDecimal={false}
          hideControls
          value={payInterval}
          onChange={setPayInterval}
        />
      )}

      {perPayment && arrivesEvery && <PerPaymentNote perPayment={perPayment} />}

      {arrivesAnnually && <AnnualArrivalNote />}

      {taxable && !isOneOff && (
        <Switch
          size="sm"
          label="Arrives in every pay period"
          description="On for pay that lands every cycle. Off for pay that lands in only some of them — an on-call allowance paid on the fortnightly payrun, but only for the fortnights a shift was worked. The yearly figure still counts in full in the tax estimate, the budget, and available cash; a payslip simply stops expecting a share of it every period, and the year is where you read whether it is tracking."
          checked={arrivesEveryPeriod}
          onChange={(event) => setArrivesEveryPeriod(event.currentTarget.checked)}
        />
      )}

      {taxable && !isOneOff && (
        <Switch
          size="sm"
          label="Employer super accrues on this"
          description="On for ordinary time earnings — salary and wages, which the super guarantee is paid on. Off for an allowance paid on top, such as on-call: it is taxed in full, but no super accrues on it."
          checked={attractsSuper}
          onChange={(event) => setAttractsSuper(event.currentTarget.checked)}
        />
      )}

      {jointEligible && (
        <Switch
          size="sm"
          label="Joint income"
          description="On for income both partners are assessed on — joint interest, jointly-held dividends, a jointly-owned rental. The tax estimate splits it between you at the percentage below; every projection still counts the whole amount as household cash."
          checked={isJoint}
          onChange={(event) => setIsJoint(event.currentTarget.checked)}
        />
      )}

      {joint && (
        <NumberInput
          label={`Split — % to ${primaryMemberName}`}
          size="sm"
          description={`${otherMemberName}: ${splitPercentValid ? 100 - splitPercentNum : '—'}%`}
          min={0}
          max={100}
          step={1}
          allowDecimal={false}
          hideControls
          value={splitPercent}
          onChange={setSplitPercent}
        />
      )}

      {!isOneOff && (
        <Group grow align="flex-start">
          <DateInput
            label="Effective from"
            size="sm"
            description="Leave blank if this applies all financial year. To model a change — a pay rise, or an arrangement that ends — set an end date and add a second inflow starting the next day."
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
