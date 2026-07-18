import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import type { BudgetGroup, BudgetLine, BudgetLineInput, Frequency } from '../hooks/useBudgetLines'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import { centsToDollars, dollarsToCents } from '../lib/money'

interface BudgetLineFormProps {
  initial?: BudgetLine
  defaultGroup?: BudgetGroup
  onSubmit: (input: BudgetLineInput) => void | Promise<void>
  onCancel?: () => void
}

const SCHEDULES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'biannual', label: 'Biannual' },
  { value: 'annual', label: 'Annual' },
]

/** Presentational add/edit form for a single budget line. Persistence lives in the caller. */
export function BudgetLineForm({ initial, defaultGroup, onSubmit, onCancel }: BudgetLineFormProps) {
  const [group, setGroup] = useState<BudgetGroup>(initial?.line_group ?? defaultGroup ?? 'needs')
  const [name, setName] = useState(initial?.name ?? '')
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'fortnightly')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() !== '' && amount !== '' && !submitting

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
      goal_id: initial?.goal_id ?? null,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this budget line. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="md" component="form" onSubmit={handleSubmit}>
      <Stack gap="md">
        <Select
          label="Group"
          data={BUDGET_GROUPS}
          value={group}
          onChange={(value) => value && setGroup(value as BudgetGroup)}
          allowDeselect={false}
        />

        <TextInput
          label="Name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />

        <Select
          label="Frequency"
          description="The app converts every amount to fortnightly and annual."
          data={SCHEDULES}
          value={frequency}
          onChange={(value) => value && setFrequency(value as Frequency)}
          allowDeselect={false}
        />

        <NumberInput
          label="Amount"
          prefix="$"
          thousandSeparator
          decimalScale={2}
          fixedDecimalScale
          min={0}
          hideControls
          value={amount}
          onChange={setAmount}
        />

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
