import { useState } from 'react'
import { TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { TemporaryItem, TemporaryItemInput } from '../hooks/useTemporaryItems'
import { todayIso } from '../lib/dates'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface TemporaryItemFormProps {
  initial?: TemporaryItem
  onSubmit: (input: TemporaryItemInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for a single temporary item. Persistence lives in the caller. */
export function TemporaryItemForm({ initial, onSubmit, onCancel }: TemporaryItemFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [contribution, setContribution] = useState<number | string>(
    centsToDollars(initial?.contribution_cents),
  )
  const [targetDate, setTargetDate] = useState<string | null>(initial?.target_date ?? todayIso())

  const canSubmit = name.trim() !== '' && contribution !== '' && targetDate !== null

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this temporary item. Please try again.',
    onSubmit,
    buildInput: (): TemporaryItemInput => ({
      name: name.trim(),
      contribution_cents: dollarsToCents(contribution) ?? 0,
      target_date: targetDate!,
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
      <TextInput
        label="Name"
        size="sm"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />

      <MoneyInput
        label="Contribution"
        size="sm"
        description="The fortnightly amount put toward this item."
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
    </FormShell>
  )
}
