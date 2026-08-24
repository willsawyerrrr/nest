import { useState } from 'react'
import { SegmentedControl, Select, Text } from '@mantine/core'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { GiftRecipient } from '../hooks/useGifts'
import type { GiftLinkRecipient } from '../lib/giftCandidates'
import { compareRecipients } from '../lib/gifts'
import { FormShell } from './FormShell'

/** The fields an assignment writes onto the purchase; the caller merges in the rest. */
export interface GiftPurchaseAssignment {
  gift_budget_id?: string
  gift_discretionary_budget_id?: string
  recipient_id?: string | null
}

type AssignDestination = 'gift' | 'adhoc'

interface GiftPurchaseAssignFormProps {
  /** The recipients budgeted for a specific gift, each with their occasions. */
  recipientChoices: GiftLinkRecipient[]
  /** The household's ad hoc buffer id, or null before its first edit. */
  discretionaryBudgetId: string | null
  /** Every recipient, offered as an optional tag when assigning to the ad hoc buffer. */
  recipients: GiftRecipient[]
  onSubmit: (assignment: GiftPurchaseAssignment) => void | Promise<void>
  onCancel?: (() => void) | undefined
}

/**
 * Assigns an unassigned purchase to either a specific gift — choosing the
 * recipient and then one of their budgeted occasions, the same pairing that
 * names exactly one `gift_budget` — or the household's ad hoc buffer, where it
 * may optionally carry the same record-keeping recipient tag any other ad hoc
 * purchase can. The purchase's amount, date, and description are untouched;
 * only which budget it counts against changes.
 */
export function GiftPurchaseAssignForm({
  recipientChoices,
  discretionaryBudgetId,
  recipients,
  onSubmit,
  onCancel,
}: GiftPurchaseAssignFormProps) {
  const [destination, setDestination] = useState<AssignDestination>(
    recipientChoices.length > 0 ? 'gift' : 'adhoc',
  )
  const [recipientId, setRecipientId] = useState('')
  const [budgetId, setBudgetId] = useState('')
  const [tagRecipientId, setTagRecipientId] = useState<string | null>(null)

  const chosenRecipient = recipientChoices.find((choice) => choice.value === recipientId)

  // A recipient's occasions are their own, so switching recipient starts the
  // occasion afresh.
  function chooseRecipient(value: string) {
    setRecipientId(value)
    setBudgetId('')
  }

  const canSubmit = destination === 'gift' ? budgetId !== '' : discretionaryBudgetId !== null

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not assign this purchase. Please try again.',
    buildInput: (): GiftPurchaseAssignment =>
      destination === 'gift'
        ? { gift_budget_id: budgetId }
        : { gift_discretionary_budget_id: discretionaryBudgetId!, recipient_id: tagRecipientId },
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
      <SegmentedControl
        fullWidth
        size="sm"
        aria-label="Assign to"
        value={destination}
        onChange={(value) => setDestination(value as AssignDestination)}
        data={[
          { label: 'A specific gift', value: 'gift' },
          { label: 'Ad hoc gifts', value: 'adhoc' },
        ]}
      />

      {destination === 'gift' ? (
        <>
          {/* An unset select takes `null`, not `''`: a `Select` shows its
              placeholder for the former and keeps its last label for the latter. */}
          <Select
            label="Recipient"
            size="sm"
            placeholder="Choose a recipient"
            data={recipientChoices.map(({ value, label }) => ({ value, label }))}
            value={recipientId || null}
            onChange={(value) => chooseRecipient(value ?? '')}
            allowDeselect={false}
            disabled={recipientChoices.length === 0}
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

          {recipientChoices.length === 0 && (
            <Text size="xs" c="dimmed">
              No gift budgets yet — add one to assign a purchase to a specific gift.
            </Text>
          )}
        </>
      ) : discretionaryBudgetId === null ? (
        <Text size="xs" c="dimmed">
          Set the ad hoc gifts budget below before assigning purchases to it.
        </Text>
      ) : (
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
          value={tagRecipientId}
          onChange={setTagRecipientId}
        />
      )}
    </FormShell>
  )
}
