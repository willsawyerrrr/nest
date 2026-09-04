import { useState } from 'react'
import { Alert, NumberInput, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Goal, GoalInput } from '../hooks/useGoals'
import type { Saver } from '../hooks/useSavers'
import { interestBpsToPercent, interestPercentToBps } from '../lib/goals'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface GoalFormProps {
  initial?: Goal | undefined
  /** Seeds a new goal's name and target from a wishlist item; ignored when editing. */
  draft?: { name: string; amountCents: number } | undefined
  savers: Saver[]
  onSubmit: (input: GoalInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for a single savings goal. Persistence lives in the caller. */
export function GoalForm({ initial, draft, savers, onSubmit, onCancel }: GoalFormProps) {
  const [name, setName] = useState(initial?.name ?? draft?.name ?? '')
  const [targetAmount, setTargetAmount] = useState<number | string>(
    centsToDollars(initial?.target_amount_cents ?? draft?.amountCents),
  )
  const [targetDate, setTargetDate] = useState<string | null>(initial?.target_date ?? null)
  const [currentBalance, setCurrentBalance] = useState<number | string>(
    centsToDollars(initial?.current_balance_cents),
  )
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(
    initial?.linked_account_id ?? null,
  )
  const [interestRate, setInterestRate] = useState<number | string>(
    interestBpsToPercent(initial?.annual_interest_bps),
  )
  const [plannedContribution, setPlannedContribution] = useState<number | string>(
    centsToDollars(initial?.planned_contribution_cents),
  )
  const canSubmit = name.trim() !== '' && targetAmount !== ''
  const linkedSaverDeleted = savers.some(
    (saver) => saver.id === linkedAccountId && saver.deleted_from_source_at !== null,
  )

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this goal. Please try again.',
    onSubmit,
    buildInput: (): GoalInput => ({
      name: name.trim(),
      target_amount_cents: dollarsToCents(targetAmount) ?? 0,
      target_date: targetDate,
      current_balance_cents: dollarsToCents(currentBalance) ?? 0,
      linked_account_id: linkedAccountId,
      annual_interest_bps: interestPercentToBps(interestRate),
      queue_position: initial?.queue_position ?? null,
      planned_contribution_cents: dollarsToCents(plannedContribution),
    }),
  })

  const handleSaverChange = (accountId: string | null) => {
    setLinkedAccountId(accountId)
    const saver = savers.find((candidate) => candidate.id === accountId)
    if (saver && name.trim() === '') {
      setName(saver.name)
    }
  }

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="goal"
      onCancel={onCancel}
    >
      <TextInput
        label="Name"
        size="sm"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />

      <MoneyInput
        label="Target amount"
        size="sm"
        min={0}
        hideControls
        value={targetAmount}
        onChange={setTargetAmount}
      />

      <DateInput
        label="Target date"
        size="sm"
        description="Optional. Sets the contribution needed to reach the target."
        valueFormat="D MMM YYYY"
        clearable
        value={targetDate}
        onChange={setTargetDate}
      />

      <NumberInput
        label="Modelled interest rate (% p.a.)"
        size="sm"
        description="Optional. Compounds fortnightly in the projected ETA and required contribution."
        suffix="%"
        decimalScale={2}
        min={0}
        max={100}
        hideControls
        value={interestRate}
        onChange={setInterestRate}
      />

      <MoneyInput
        label="Planned fortnightly contribution"
        size="sm"
        description="Optional. What this goal draws from freed-up saving once the goals above it finish. Blank draws the whole available amount."
        min={0}
        hideControls
        value={plannedContribution}
        onChange={setPlannedContribution}
      />

      {savers.length > 0 ? (
        <Select
          label="Up saver"
          size="sm"
          description="Optional. Pulls the current balance from a synced Up saver."
          placeholder="Not linked"
          clearable
          searchable
          nothingFoundMessage="No matching savers"
          data={savers.map((saver) => ({
            value: saver.id,
            label: saver.deleted_from_source_at ? `${saver.name} (deleted in Up)` : saver.name,
          }))}
          value={linkedAccountId}
          onChange={handleSaverChange}
        />
      ) : (
        <Text size="xs" c="dimmed">
          Connect Up and sync to link a saver.
        </Text>
      )}

      {linkedSaverDeleted && (
        <Alert color="warning" variant="light" p="xs">
          This saver was deleted in Up. Link the goal to a current saver, or clear the link and
          track the balance manually.
        </Alert>
      )}

      {linkedAccountId === null && (
        <MoneyInput
          label="Current balance"
          size="sm"
          description="Entered manually for now."
          min={0}
          hideControls
          value={currentBalance}
          onChange={setCurrentBalance}
        />
      )}
    </FormShell>
  )
}
