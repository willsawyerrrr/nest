import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import type { Frequency } from '../hooks/useBudgetLines'
import type { Medication, MedicationInput } from '../hooks/useMedications'
import { centsToDollars, dollarsToCents } from '../lib/money'

interface MedicationFormProps {
  initial?: Medication
  onSubmit: (input: MedicationInput) => void | Promise<void>
  onCancel?: () => void
}

const SCHEDULES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'biannual', label: 'Biannually' },
  { value: 'annual', label: 'Annually' },
  { value: 'every_n_weeks', label: 'Every N weeks' },
]

/** Presentational add/edit form for a single medication. Persistence lives in the caller. */
export function MedicationForm({ initial, onSubmit, onCancel }: MedicationFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [dose, setDose] = useState(initial?.dose ?? '')
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'monthly')
  const [intervalWeeks, setIntervalWeeks] = useState<number | string>(initial?.interval_weeks ?? '')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEveryNWeeks = frequency === 'every_n_weeks'
  const intervalValid = Number.isInteger(Number(intervalWeeks)) && Number(intervalWeeks) >= 1

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
    const input: MedicationInput = {
      name: name.trim(),
      dose: dose.trim() === '' ? null : dose.trim(),
      amount_cents: dollarsToCents(amount) ?? 0,
      frequency,
      interval_weeks: isEveryNWeeks ? Number(intervalWeeks) : null,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this medication. Please try again.')
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

        <TextInput
          label="Dose"
          size="sm"
          description="Optional. An informational label (e.g. 50 mg daily)."
          value={dose}
          onChange={(event) => setDose(event.currentTarget.value)}
        />

        <Select
          label="Frequency"
          size="sm"
          description="The app converts every cost to fortnightly and annual."
          data={SCHEDULES}
          value={frequency}
          onChange={(value) => value && setFrequency(value as Frequency)}
          allowDeselect={false}
        />

        {isEveryNWeeks && (
          <NumberInput
            label="Weeks between costs"
            size="sm"
            description="How many weeks apart each cost lands (e.g. 4 for once every four weeks)."
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

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add medication'}
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
