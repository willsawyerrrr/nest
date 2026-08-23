import { useState } from 'react'
import { Select, Text } from '@mantine/core'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { GiftLinkRecipient } from '../lib/giftCandidates'
import { FormShell } from './FormShell'

interface GiftPurchaseAssignFormProps {
  /** The recipients this purchase can be assigned to, each with their budgeted occasions. */
  recipientChoices: GiftLinkRecipient[]
  onSubmit: (budgetId: string) => void | Promise<void>
  onCancel?: (() => void) | undefined
}

/**
 * Assigns an ad hoc purchase to a specific gift budget, choosing the
 * recipient and then one of their budgeted occasions — the same pairing that
 * names exactly one `gift_budget`, mirroring how a synced transaction is
 * linked from the gift inbox. The purchase's amount, date, and description
 * are untouched; only which budget it counts against changes.
 */
export function GiftPurchaseAssignForm({
  recipientChoices,
  onSubmit,
  onCancel,
}: GiftPurchaseAssignFormProps) {
  const [recipientId, setRecipientId] = useState('')
  const [budgetId, setBudgetId] = useState('')

  const chosenRecipient = recipientChoices.find((choice) => choice.value === recipientId)

  // A recipient's occasions are their own, so switching recipient starts the
  // occasion afresh.
  function chooseRecipient(value: string) {
    setRecipientId(value)
    setBudgetId('')
  }

  const canSubmit = budgetId !== ''

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not assign this purchase. Please try again.',
    buildInput: () => budgetId,
    onSubmit,
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      submitLabel="Assign"
      onCancel={onCancel}
    >
      {/* An unset select takes `null`, not `''`: a `Select` shows its placeholder
          for the former and keeps its last label for the latter. */}
      <Select
        label="Recipient"
        size="sm"
        placeholder="Choose a recipient"
        data={recipientChoices.map(({ value, label }) => ({ value, label }))}
        value={recipientId || null}
        onChange={(value) => chooseRecipient(value ?? '')}
        allowDeselect={false}
      />

      <Select
        label="Occasion"
        size="sm"
        placeholder={chosenRecipient ? 'Choose an occasion' : 'Choose a recipient first'}
        data={chosenRecipient?.occasions ?? []}
        value={budgetId || null}
        onChange={(value) => setBudgetId(value ?? '')}
        allowDeselect={false}
        disabled={!chosenRecipient}
      />

      <Text size="xs" c="dimmed">
        Moves this purchase out of the ad hoc buffer and into their gift budget.
      </Text>
    </FormShell>
  )
}
