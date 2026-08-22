import { useState } from 'react'
import { Select, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { GiftPurchase, GiftPurchaseInput, GiftRecipient } from '../hooks/useGifts'
import { todayIso } from '../lib/dates'
import { compareRecipients } from '../lib/gifts'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface GiftPurchaseFormProps {
  /** The gift budget this purchase counts against; omit for an ad hoc purchase. */
  budgetId?: string
  /** The household's discretionary buffer this ad hoc purchase counts against; omit for a budget-linked purchase. */
  discretionaryBudgetId?: string
  /**
   * The household's recipients (members and external people), offered as an
   * optional record-keeping tag. Given only for an ad hoc purchase
   * (`discretionaryBudgetId` set) — a budget-linked purchase's recipient is
   * already its gift budget's.
   */
  recipients?: GiftRecipient[]
  initial?: GiftPurchase
  onSubmit: (input: GiftPurchaseInput) => void | Promise<void>
  onCancel?: (() => void) | undefined
}

/**
 * Presentational add/edit form for one gift purchase, budget-linked or ad hoc.
 * Persistence lives in the caller.
 */
export function GiftPurchaseForm({
  budgetId,
  discretionaryBudgetId,
  recipients,
  initial,
  onSubmit,
  onCancel,
}: GiftPurchaseFormProps) {
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [purchasedOn, setPurchasedOn] = useState<string | null>(initial?.purchased_on ?? todayIso())
  const [recipientId, setRecipientId] = useState<string | null>(initial?.recipient_id ?? null)

  const canSubmit = amount !== '' && purchasedOn !== null

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this purchase. Please try again.',
    onSubmit,
    buildInput: (): GiftPurchaseInput => ({
      gift_budget_id: budgetId,
      gift_discretionary_budget_id: discretionaryBudgetId,
      recipient_id: discretionaryBudgetId !== undefined ? recipientId : undefined,
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

      {recipients !== undefined && (
        <Select
          label="Recipient"
          description="Optional. Record-keeping only — this doesn't budget for them."
          size="sm"
          placeholder="Untagged"
          clearable
          clearButtonProps={{ 'aria-label': 'Clear recipient' }}
          data={[...recipients]
            .sort(compareRecipients)
            .map((recipient) => ({ value: recipient.id, label: recipient.name }))}
          value={recipientId}
          onChange={setRecipientId}
        />
      )}
    </FormShell>
  )
}
