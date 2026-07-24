import { useState } from 'react'
import { TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { GiftPurchase, GiftPurchaseInput } from '../hooks/useGifts'
import { todayIso } from '../lib/dates'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface GiftPurchaseFormProps {
  budgetId: string
  initial?: GiftPurchase
  onSubmit: (input: GiftPurchaseInput) => void | Promise<void>
  onCancel?: (() => void) | undefined
}

/** Presentational add/edit form for one gift purchase. Persistence lives in the caller. */
export function GiftPurchaseForm({ budgetId, initial, onSubmit, onCancel }: GiftPurchaseFormProps) {
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [purchasedOn, setPurchasedOn] = useState<string | null>(initial?.purchased_on ?? todayIso())

  const canSubmit = amount !== '' && purchasedOn !== null

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this purchase. Please try again.',
    onSubmit,
    buildInput: (): GiftPurchaseInput => ({
      gift_budget_id: budgetId,
      amount_cents: dollarsToCents(amount) ?? 0,
      description: description.trim(),
      purchased_on: purchasedOn!,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="purchase"
      onCancel={onCancel}
    >
      <TextInput
        label="Description"
        size="sm"
        placeholder="What was bought"
        value={description}
        onChange={(event) => setDescription(event.currentTarget.value)}
      />

      <MoneyInput
        label="Amount"
        size="sm"
        min={0}
        hideControls
        value={amount}
        onChange={setAmount}
      />

      <DateInput
        label="Purchased on"
        size="sm"
        valueFormat="D MMM YYYY"
        value={purchasedOn}
        onChange={setPurchasedOn}
      />
    </FormShell>
  )
}
