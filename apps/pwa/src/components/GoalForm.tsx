import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { Goal, GoalInput } from '../hooks/useGoals'
import type { Saver } from '../hooks/useSavers'
import { centsToDollars, dollarsToCents } from '../lib/money'

interface GoalFormProps {
  initial?: Goal
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() !== '' && targetAmount !== '' && !submitting

  const handleSaverChange = (accountId: string | null) => {
    setLinkedAccountId(accountId)
    if (accountId !== null && name.trim() === '') {
      const saver = savers.find((candidate) => candidate.id === accountId)
      if (saver) {
        setName(saver.name)
      }
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    const input: GoalInput = {
      name: name.trim(),
      target_amount_cents: dollarsToCents(targetAmount) ?? 0,
      target_date: targetDate,
      current_balance_cents: dollarsToCents(currentBalance) ?? 0,
      linked_account_id: linkedAccountId,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this goal. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />

        <NumberInput
          label="Target amount"
          size="sm"
          prefix="$"
          thousandSeparator
          decimalScale={2}
          fixedDecimalScale
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
          <NumberInput
            label="Current balance"
            size="sm"
            description="Entered manually for now."
            prefix="$"
            thousandSeparator
            decimalScale={2}
            fixedDecimalScale
            min={0}
            hideControls
            value={currentBalance}
            onChange={setCurrentBalance}
          />
        )}

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add goal'}
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
