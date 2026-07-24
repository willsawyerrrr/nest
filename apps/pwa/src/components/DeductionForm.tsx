import { useState } from 'react'
import { TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { DeductionInput, DeductionRow } from '../hooks/useDeductions'
import { useFormSubmit } from '../hooks/useFormSubmit'
import { todayIso } from '../lib/dates'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface DeductionFormProps {
  member: { id: string; name: string }
  initial?: DeductionRow
  onSubmit: (input: DeductionInput) => void | Promise<void>
  onCancel?: () => void
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

  const canSubmit = description.trim() !== '' && amount !== '' && deductionDate !== null

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this deduction. Please try again.',
    onSubmit,
    buildInput: (): DeductionInput => ({
      member_id: member.id,
      description: description.trim(),
      amount_cents: dollarsToCents(amount) ?? 0,
      deduction_date: deductionDate!,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="deduction"
      onCancel={onCancel}
    >
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
    </FormShell>
  )
}
