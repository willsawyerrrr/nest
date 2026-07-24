import { useState } from 'react'
import { Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Goal, GoalInput } from '../hooks/useGoals'
import type { Saver } from '../hooks/useSavers'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface GoalFormProps {
  initial?: Goal | undefined
  savers: Saver[]
  onSubmit: (input: GoalInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for a single savings goal. Persistence lives in the caller. */
export function GoalForm({ initial, savers, onSubmit, onCancel }: GoalFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [targetAmount, setTargetAmount] = useState<number | string>(
    centsToDollars(initial?.target_amount_cents),
  )
  const [targetDate, setTargetDate] = useState<string | null>(initial?.target_date ?? null)
  const [currentBalance, setCurrentBalance] = useState<number | string>(
    centsToDollars(initial?.current_balance_cents),
  )
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(
    initial?.linked_account_id ?? null,
  )
  const canSubmit = name.trim() !== '' && targetAmount !== ''

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
    }),
  })

  const handleSaverChange = (accountId: string | null) => {
    setLinkedAccountId(accountId)
    if (accountId !== null && name.trim() === '') {
      const saver = savers.find((candidate) => candidate.id === accountId)
      if (saver) {
        setName(saver.name)
      }
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

      {savers.length > 0 ? (
        <Select
          label="Up saver"
          size="sm"
          description="Optional. Pulls the current balance from a synced Up saver."
          placeholder="Not linked"
          clearable
          searchable
          nothingFoundMessage="No matching savers"
          data={savers.map((saver) => ({ value: saver.id, label: saver.name }))}
          value={linkedAccountId}
          onChange={handleSaverChange}
        />
      ) : (
        <Text size="xs" c="dimmed">
          Connect Up and sync to link a saver.
        </Text>
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
