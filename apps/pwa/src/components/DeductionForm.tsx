import { useState, type FormEvent } from 'react'
import { Button, Card, Group, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { DeductionInput, DeductionRow } from '../hooks/useDeductions'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { MoneyInput } from './MoneyInput'

interface DeductionFormProps {
  member: { id: string; name: string }
  initial?: DeductionRow
  onSubmit: (input: DeductionInput) => void | Promise<void>
  onCancel?: () => void
}

/** Today as an ISO date (`YYYY-MM-DD`), the default date for a new deduction. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Presentational add/edit form for a single deduction, tagged to the member the
 * section belongs to. Persistence lives in the caller.
 */
export function DeductionForm({ member, initial, onSubmit, onCancel }: DeductionFormProps) {
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [deductionDate, setDeductionDate] = useState<string | null>(
    initial?.deduction_date ?? todayIso(),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit =
    description.trim() !== '' && amount !== '' && deductionDate !== null && !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || deductionDate === null) {
      return
    }
    setSubmitting(true)
    setError(null)
    const input: DeductionInput = {
      member_id: member.id,
      description: description.trim(),
      amount_cents: dollarsToCents(amount) ?? 0,
      deduction_date: deductionDate,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this deduction. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <TextInput
          label="Description"
          size="sm"
          placeholder="e.g. Home office running costs"
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />

        <MoneyInput
          label="Amount"
          size="sm"
          description="The deductible amount."
          min={0}
          hideControls
          value={amount}
          onChange={setAmount}
        />

        <DateInput
          label="Date"
          size="sm"
          valueFormat="D MMM YYYY"
          value={deductionDate}
          onChange={setDeductionDate}
        />

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add deduction'}
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
