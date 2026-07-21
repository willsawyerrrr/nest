import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import type { BudgetGroup, Frequency } from '../lib/domain'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import { FREQUENCY_OPTIONS } from '../lib/frequency'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { EnumSelect } from './EnumSelect'

interface BudgetLineFormProps {
  initial?: BudgetLine
  defaultGroup?: BudgetGroup
  /** The household's goals, offered as a link target on savings/investments lines. */
  goals?: { id: string; name: string }[]
  /** The household's accounts, offered as the funding destination on non-savings/investments lines. */
  accounts?: { id: string; name: string }[]
  onSubmit: (input: BudgetLineInput) => void | Promise<void>
  onCancel?: () => void
}

/** Whether lines in a group may link to a savings goal (the DB CHECK allows only these). */
function groupLinksGoal(group: BudgetGroup): boolean {
  return group === 'savings' || group === 'investments'
}

/** Presentational add/edit form for a single manual budget line. Persistence lives in the caller. */
export function BudgetLineForm({
  initial,
  defaultGroup,
  goals = [],
  accounts = [],
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const showGoalPicker = groupLinksGoal(group)
  // Savings/Investments lines route to their goal's account, so they carry no
  // direct destination; every other group offers a "Funded from" picker.
  const showAccountPicker = !groupLinksGoal(group)
  const isEveryNWeeks = frequency === 'every_n_weeks'
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

  const canSubmit =
    name.trim() !== '' &&
    amount !== '' &&
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
      line_group: group,
      name: name.trim(),
      amount_cents: dollarsToCents(amount) ?? 0,
      frequency,
      interval_weeks: isEveryNWeeks ? Number(intervalWeeks) : null,
      goal_id: showGoalPicker ? goalId : null,
      breakdown_id: null,
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
        <EnumSelect
          label="Group"
          size="sm"
          data={BUDGET_GROUPS}
          value={group}
          onChange={(value) => value && changeGroup(value)}
          allowDeselect={false}
        />

        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />

        <EnumSelect
          label="Frequency"
          size="sm"
          description="The app converts every amount to fortnightly and annual."
          data={FREQUENCY_OPTIONS}
          value={frequency}
          onChange={(value) => value && setFrequency(value)}
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
