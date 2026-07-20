import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Anchor,
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
import type { BudgetGroup, BudgetLine, BudgetLineInput, Frequency } from '../hooks/useBudgetLines'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import { centsToDollars, dollarsToCents, formatCents } from '../lib/money'

interface BudgetLineFormProps {
  initial?: BudgetLine
  defaultGroup?: BudgetGroup
  /** The household's goals, offered as a link target on savings/investments lines. */
  goals?: { id: string; name: string }[]
  /** The household's accounts, offered as the funding destination on non-savings/investments lines. */
  accounts?: { id: string; name: string }[]
  /** The household's total planned gift spend, shown when the amount is derived from the gift tracker. */
  giftTotalCents?: number
  /** Whether the gift-tracker amount source may be chosen (one gift-derived line per household). */
  giftSourceAvailable?: boolean
  /** The household's total annual medication cost, shown when the amount is derived from the medication tracker. */
  medicationTotalCents?: number
  /** Whether the medication-tracker amount source may be chosen (one medication-derived line per household). */
  medicationSourceAvailable?: boolean
  onSubmit: (input: BudgetLineInput) => void | Promise<void>
  onCancel?: () => void
}

/** Where a line's amount comes from: a typed figure, or a derived tracker total. */
type AmountSource = 'manual' | 'gift' | 'medication'

/** The tracker each derived amount source rolls up from, keyed by its source value. */
const DERIVED_SOURCES = {
  gift: { label: 'the gift tracker', path: '/gifts', segment: 'From the gift tracker' },
  medication: {
    label: 'the medication tracker',
    path: '/health',
    segment: 'From the medication tracker',
  },
} as const

/** Whether lines in a group may link to a savings goal (the DB CHECK allows only these). */
function groupLinksGoal(group: BudgetGroup): boolean {
  return group === 'savings' || group === 'investments'
}

const SCHEDULES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'biannual', label: 'Biannually' },
  { value: 'annual', label: 'Annually' },
  { value: 'every_n_weeks', label: 'Every N weeks' },
]

/** Presentational add/edit form for a single budget line. Persistence lives in the caller. */
export function BudgetLineForm({
  initial,
  defaultGroup,
  goals = [],
  accounts = [],
  giftTotalCents = 0,
  giftSourceAvailable = false,
  medicationTotalCents = 0,
  medicationSourceAvailable = false,
  onSubmit,
  onCancel,
}: BudgetLineFormProps) {
  const [group, setGroup] = useState<BudgetGroup>(initial?.line_group ?? defaultGroup ?? 'needs')
  const [name, setName] = useState(initial?.name ?? '')
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'fortnightly')
  const [intervalWeeks, setIntervalWeeks] = useState<number | string>(initial?.interval_weeks ?? '')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [goalId, setGoalId] = useState<string | null>(initial?.goal_id ?? null)
  const [destinationAccountId, setDestinationAccountId] = useState<string | null>(
    initial?.destination_account_id ?? null,
  )
  const [amountSource, setAmountSource] = useState<AmountSource>(
    initial?.derived_source ?? 'manual',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const derived = amountSource !== 'manual'
  const derivedTotalCents =
    amountSource === 'gift'
      ? giftTotalCents
      : amountSource === 'medication'
        ? medicationTotalCents
        : 0
  // A medication line rolls up into the Needs group; every other line keeps its
  // chosen group. When medication is the source the group is fixed accordingly.
  const effectiveGroup: BudgetGroup = amountSource === 'medication' ? 'needs' : group
  const showGoalPicker = groupLinksGoal(effectiveGroup) && !derived
  // Savings/Investments lines route to their goal's account, so they carry no
  // direct destination; every other group offers a "Funded from" picker.
  const showAccountPicker = !groupLinksGoal(effectiveGroup)
  // Offer each derived source when it is available, and always when editing the
  // existing line that already derives from it.
  const sourceOptions: { value: AmountSource; label: string }[] = [
    { value: 'manual', label: 'Enter an amount' },
    ...(giftSourceAvailable || amountSource === 'gift'
      ? [{ value: 'gift' as const, label: DERIVED_SOURCES.gift.segment }]
      : []),
    ...(medicationSourceAvailable || amountSource === 'medication'
      ? [{ value: 'medication' as const, label: DERIVED_SOURCES.medication.segment }]
      : []),
  ]
  const showAmountSource = sourceOptions.length > 1
  const isEveryNWeeks = !derived && frequency === 'every_n_weeks'
  const intervalValid = Number.isInteger(Number(intervalWeeks)) && Number(intervalWeeks) >= 1

  const changeGroup = (next: BudgetGroup) => {
    setGroup(next)
    if (groupLinksGoal(next)) {
      // Savings/Investments carry no direct destination (the DB CHECK bars it).
      setDestinationAccountId(null)
    } else {
      setGoalId(null)
    }
  }

  const changeAmountSource = (next: AmountSource) => {
    setAmountSource(next)
    // A medication line always lands in Needs, which links no goal.
    if (next === 'medication') {
      setGoalId(null)
    }
  }

  const canSubmit =
    name.trim() !== '' &&
    (derived || amount !== '') &&
    (isEveryNWeeks ? intervalWeeks !== '' && intervalValid : true) &&
    !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    const input: BudgetLineInput = {
      line_group: effectiveGroup,
      name: name.trim(),
      amount_cents: derived ? derivedTotalCents : (dollarsToCents(amount) ?? 0),
      frequency: derived ? 'annual' : frequency,
      interval_weeks: isEveryNWeeks ? Number(intervalWeeks) : null,
      goal_id: showGoalPicker ? goalId : null,
      derived_source: derived ? amountSource : null,
      destination_account_id: showAccountPicker ? destinationAccountId : null,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this budget line. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <Select
          label="Group"
          size="sm"
          data={BUDGET_GROUPS}
          value={effectiveGroup}
          onChange={(value) => value && changeGroup(value as BudgetGroup)}
          allowDeselect={false}
          // A medication line is fixed to Needs, so its group is not editable.
          disabled={amountSource === 'medication'}
          description={
            amountSource === 'medication' ? 'Medication lines roll up into Needs.' : undefined
          }
        />

        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />

        {showAmountSource && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Amount source
            </Text>
            <SegmentedControl
              size="sm"
              fullWidth
              data={sourceOptions}
              value={amountSource}
              onChange={(value) => changeAmountSource(value as AmountSource)}
            />
          </Stack>
        )}

        {amountSource !== 'manual' ? (
          <div>
            <Text size="sm" fw={500}>
              Amount
            </Text>
            <Text size="sm">{formatCents(derivedTotalCents)} / year</Text>
            <Text size="xs" c="dimmed">
              Derived from your total. Edit it in the{' '}
              <Anchor component={Link} to={DERIVED_SOURCES[amountSource].path}>
                {DERIVED_SOURCES[amountSource].label}
              </Anchor>
              .
            </Text>
          </div>
        ) : (
          <>
            <Select
              label="Frequency"
              size="sm"
              description="The app converts every amount to fortnightly and annual."
              data={SCHEDULES}
              value={frequency}
              onChange={(value) => value && setFrequency(value as Frequency)}
              allowDeselect={false}
            />

            {isEveryNWeeks && (
              <NumberInput
                label="Weeks between allocations"
                size="sm"
                description="How many weeks apart each allocation lands (e.g. 4 for once every four weeks)."
                min={1}
                step={1}
                allowDecimal={false}
                hideControls
                value={intervalWeeks}
                onChange={setIntervalWeeks}
              />
            )}

            <NumberInput
              label="Amount"
              size="sm"
              prefix="$"
              thousandSeparator
              decimalScale={2}
              fixedDecimalScale
              min={0}
              hideControls
              value={amount}
              onChange={setAmount}
            />
          </>
        )}

        {showGoalPicker && (
          <>
            <Select
              label="Goal"
              size="sm"
              description="Optional. Links this line's contribution to a savings goal."
              placeholder="No goal"
              data={goals.map((goal) => ({ value: goal.id, label: goal.name }))}
              value={goalId}
              onChange={setGoalId}
              clearable
              nothingFoundMessage="No goals yet"
            />
            <Text size="xs" c="dimmed">
              This line's pay split is routed to its goal's linked Up saver.
            </Text>
          </>
        )}

        {showAccountPicker && (
          <Select
            label="Funded from"
            size="sm"
            description="Optional. The account or Up saver whose pay split funds this line."
            placeholder="Not routed"
            data={accounts.map((account) => ({ value: account.id, label: account.name }))}
            value={destinationAccountId}
            onChange={setDestinationAccountId}
            clearable
            searchable
            nothingFoundMessage="No matching accounts"
          />
        )}

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add line'}
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
