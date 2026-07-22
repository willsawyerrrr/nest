import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Stack, Text, TextInput } from '@mantine/core'
import type { BreakdownItem, BreakdownItemInput } from '../hooks/useBreakdownItems'
import type { Frequency } from '../lib/domain'
import { FREQUENCY_OPTIONS } from '../lib/frequency'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { EnumSelect } from './EnumSelect'
import { MoneyInput } from './MoneyInput'

interface BreakdownItemFormProps {
  initial?: BreakdownItem
  onSubmit: (input: BreakdownItemInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for a single breakdown item. Persistence lives in the caller. */
export function BreakdownItemForm({ initial, onSubmit, onCancel }: BreakdownItemFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'fortnightly')
  const [interval, setInterval] = useState<number | string>(initial?.interval_count ?? '')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEveryN = frequency === 'every_n_weeks' || frequency === 'every_n_months'
  const intervalUnit = frequency === 'every_n_months' ? 'months' : 'weeks'
  const intervalValid = Number.isInteger(Number(interval)) && Number(interval) >= 1

  const canSubmit =
    name.trim() !== '' &&
    amount !== '' &&
    (isEveryN ? interval !== '' && intervalValid : true) &&
    !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    const input: BreakdownItemInput = {
      name: name.trim(),
      amount_cents: dollarsToCents(amount) ?? 0,
      frequency,
      interval_count: isEveryN ? Number(interval) : null,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this item. Please try again.')
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

        {error && (
          <Text role="alert" c="red" size="sm">
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
