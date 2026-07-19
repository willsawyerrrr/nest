import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { TemporaryItem, TemporaryItemInput } from '../hooks/useTemporaryItems'
import { centsToDollars, dollarsToCents } from '../lib/money'

interface TemporaryItemFormProps {
  initial?: TemporaryItem
  onSubmit: (input: TemporaryItemInput) => void | Promise<void>
  onCancel?: () => void
}

/** Today as an ISO date (`YYYY-MM-DD`), the default target date for a new item. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Presentational add/edit form for a single temporary item. Persistence lives in the caller. */
export function TemporaryItemForm({ initial, onSubmit, onCancel }: TemporaryItemFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [contribution, setContribution] = useState<number | string>(
    centsToDollars(initial?.contribution_cents),
  )
  const [targetDate, setTargetDate] = useState<string | null>(initial?.target_date ?? todayIso())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() !== '' && contribution !== '' && targetDate !== null && !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || targetDate === null) {
      return
    }
    setSubmitting(true)
    setError(null)
    const input: TemporaryItemInput = {
      name: name.trim(),
      contribution_cents: dollarsToCents(contribution) ?? 0,
      target_date: targetDate,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this temporary line. Please try again.')
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
          label="Contribution"
          size="sm"
          description="The fortnightly amount put toward this item."
          prefix="$"
          thousandSeparator
          decimalScale={2}
          fixedDecimalScale
          min={0}
          hideControls
          value={contribution}
          onChange={setContribution}
        />

        <DateInput
          label="Target date"
          size="sm"
          description="The item is an active outflow until this date."
          valueFormat="D MMM YYYY"
          value={targetDate}
          onChange={setTargetDate}
        />

        {error && (
          <Text role="alert" c="negative" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add item'}
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
