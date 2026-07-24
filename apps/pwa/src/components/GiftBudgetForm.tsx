import { useState } from 'react'
import { Select, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { GiftBudget, GiftBudgetInput, GiftOccasion, GiftRecipient } from '../hooks/useGifts'
import { formatIsoDate } from '../lib/dates'
import { pairKey } from '../lib/gifts'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormError } from './FormError'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface GiftBudgetFormProps {
  recipients: GiftRecipient[]
  occasions: GiftOccasion[]
  /** Existing budget when editing; its pairing is fixed and only the amount changes. */
  initial?: GiftBudget
  /** Fixes the recipient (grouping by person); its selector is hidden. */
  lockedRecipientId?: string
  /** Fixes the occasion (grouping by occasion); its selector is hidden. */
  lockedOccasionId?: string
  /** Existing `recipient:occasion` pairings, so a duplicate pairing is blocked. */
  takenPairs: Set<string>
  onSubmit: (input: GiftBudgetInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for one gift budget. Persistence lives in the caller. */
export function GiftBudgetForm({
  recipients,
  occasions,
  initial,
  lockedRecipientId,
  lockedOccasionId,
  takenPairs,
  onSubmit,
  onCancel,
}: GiftBudgetFormProps) {
  const [recipientId, setRecipientId] = useState(
    initial?.recipient_id ?? lockedRecipientId ?? recipients[0]?.id ?? '',
  )
  const [occasionId, setOccasionId] = useState(
    initial?.occasion_id ?? lockedOccasionId ?? occasions[0]?.id ?? '',
  )
  const [amount, setAmount] = useState<number | string>(
    centsToDollars(initial?.budgeted_amount_cents),
  )
  const [eventDate, setEventDate] = useState<string | null>(initial?.event_date ?? null)

  // When the chosen occasion carries its own date, that date governs and no
  // per-gift override is offered.
  const selectedOccasion = occasions.find((occasion) => occasion.id === occasionId)
  const occasionDate = selectedOccasion?.occasion_date ?? null
  const occasionHasDate = occasionDate !== null

  // A new pairing must be unique; an edit keeps its own pairing.
  const isNewPair =
    pairKey(recipientId, occasionId) !==
    (initial ? pairKey(initial.recipient_id, initial.occasion_id) : '')
  const duplicate = isNewPair && takenPairs.has(pairKey(recipientId, occasionId))

  const canSubmit = recipientId !== '' && occasionId !== '' && amount !== '' && !duplicate

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this gift budget. Please try again.',
    onSubmit,
    buildInput: (): GiftBudgetInput => ({
      recipient_id: recipientId,
      occasion_id: occasionId,
      budgeted_amount_cents: dollarsToCents(amount) ?? 0,
      event_date: occasionHasDate ? null : eventDate,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="budget"
      onCancel={onCancel}
    >
      {!lockedRecipientId && !initial && (
        <Select
          label="Recipient"
          size="sm"
          data={recipients.map((recipient) => ({ value: recipient.id, label: recipient.name }))}
          value={recipientId}
          onChange={(value) => setRecipientId(value ?? '')}
          allowDeselect={false}
        />
      )}

      {!lockedOccasionId && !initial && (
        <Select
          label="Occasion"
          size="sm"
          data={occasions.map((occasion) => ({ value: occasion.id, label: occasion.name }))}
          value={occasionId}
          onChange={(value) => setOccasionId(value ?? '')}
          allowDeselect={false}
        />
      )}

      <MoneyInput
        label="Budget"
        size="sm"
        description="The amount planned for this gift."
        min={0}
        hideControls
        value={amount}
        onChange={setAmount}
      />

      {occasionDate !== null ? (
        <Text size="sm" c="dimmed">
          Uses the occasion&rsquo;s date — {formatIsoDate(occasionDate)}
        </Text>
      ) : (
        <DateInput
          label="Date"
          size="sm"
          description="Optional. When this gift is due — e.g. this person's birthday. Falls back to the occasion's date."
          valueFormat="D MMM YYYY"
          clearable
          value={eventDate}
          onChange={setEventDate}
        />
      )}

      {duplicate && <FormError>A budget already exists for this recipient and occasion.</FormError>}
    </FormShell>
  )
}
