import { useState } from 'react'
import { NumberInput, Select, Text, TextInput } from '@mantine/core'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import { useFormSubmit } from '../hooks/useFormSubmit'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import type { BudgetGroup, Frequency } from '../lib/domain'
import { FREQUENCY_OPTIONS } from '../lib/frequency'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { EnumSelect } from './EnumSelect'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface BudgetLineFormProps {
  initial?: BudgetLine
  /** Seeds a new line's name and amount from a wishlist item; ignored when editing. */
  draft?: { name: string; amountCents: number } | undefined
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
  draft,
  defaultGroup,
  goals = [],
  accounts = [],
  onSubmit,
  onCancel,
}: BudgetLineFormProps) {
  const [group, setGroup] = useState<BudgetGroup>(initial?.line_group ?? defaultGroup ?? 'needs')
  const [name, setName] = useState(initial?.name ?? draft?.name ?? '')
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'fortnightly')
  const [interval, setInterval] = useState<number | string>(initial?.interval_count ?? '')
  const [amount, setAmount] = useState<number | string>(
    centsToDollars(initial?.amount_cents ?? draft?.amountCents),
  )
  const [goalId, setGoalId] = useState<string | null>(initial?.goal_id ?? null)
  const [destinationAccountId, setDestinationAccountId] = useState<string | null>(
    initial?.destination_account_id ?? null,
  )
  const showGoalPicker = groupLinksGoal(group)
  // Savings/Investments lines route to their goal's account, so they carry no
  // direct destination; every other group offers a "Funded from" picker.
  const showAccountPicker = !groupLinksGoal(group)
  const isEveryN = frequency === 'every_n_weeks' || frequency === 'every_n_months'
  const intervalUnit = frequency === 'every_n_months' ? 'months' : 'weeks'
  const intervalValid = Number.isInteger(Number(interval)) && Number(interval) >= 1

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
    name.trim() !== '' && amount !== '' && (isEveryN ? interval !== '' && intervalValid : true)

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this budget item. Please try again.',
    onSubmit,
    buildInput: (): BudgetLineInput => ({
      line_group: group,
      name: name.trim(),
      amount_cents: dollarsToCents(amount) ?? 0,
      frequency,
      interval_count: isEveryN ? Number(interval) : null,
      goal_id: showGoalPicker ? goalId : null,
      breakdown_id: null,
      destination_account_id: showAccountPicker ? destinationAccountId : null,
      gift_recipient_member_id: null,
      is_gift_line: false,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="item"
      onCancel={onCancel}
    >
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

      {isEveryN && (
        <NumberInput
          label={`${intervalUnit === 'months' ? 'Months' : 'Weeks'} between allocations`}
          size="sm"
          description={`How many ${intervalUnit} apart each allocation lands (e.g. 4 for once every four ${intervalUnit}).`}
          min={1}
          step={1}
          allowDecimal={false}
          hideControls
          value={interval}
          onChange={setInterval}
        />
      )}

      <MoneyInput
        label="Amount"
        size="sm"
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
    </FormShell>
  )
}
