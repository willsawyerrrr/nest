import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { Goal, GoalInput } from '../hooks/useGoals'
import { centsToDollars, dollarsToCents } from '../lib/money'

interface GoalFormProps {
  initial?: Goal
  onSubmit: (input: GoalInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for a single savings goal. Persistence lives in the caller. */
export function GoalForm({ initial, onSubmit, onCancel }: GoalFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [targetAmount, setTargetAmount] = useState<number | string>(
    centsToDollars(initial?.target_amount_cents),
  )
  const [targetDate, setTargetDate] = useState<string | null>(initial?.target_date ?? null)
  const [currentBalance, setCurrentBalance] = useState<number | string>(
    centsToDollars(initial?.current_balance_cents),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() !== '' && targetAmount !== '' && !submitting

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
      <Stack gap="sm">
        <TextInput
          label="Name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />

        <NumberInput
          label="Target amount"
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
          description="Optional. Sets the contribution needed to reach the target."
          valueFormat="D MMM YYYY"
          clearable
          value={targetDate}
          onChange={setTargetDate}
        />

        <NumberInput
          label="Current balance"
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
