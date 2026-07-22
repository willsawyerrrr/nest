import { useState, type FormEvent } from 'react'
import { Button, Card, Group, Stack, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { GiftPurchase, GiftPurchaseInput } from '../hooks/useGifts'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { MoneyInput } from './MoneyInput'

interface GiftPurchaseFormProps {
  budgetId: string
  initial?: GiftPurchase
  onSubmit: (input: GiftPurchaseInput) => void | Promise<void>
  onCancel?: () => void
}

/** Today as an ISO date (`YYYY-MM-DD`), the default purchase date for a new entry. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Presentational add/edit form for one gift purchase. Persistence lives in the caller. */
export function GiftPurchaseForm({ budgetId, initial, onSubmit, onCancel }: GiftPurchaseFormProps) {
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [purchasedOn, setPurchasedOn] = useState<string | null>(initial?.purchased_on ?? todayIso())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = amount !== '' && purchasedOn !== null && !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || purchasedOn === null) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        gift_budget_id: budgetId,
        amount_cents: dollarsToCents(amount) ?? 0,
        description: description.trim(),
        purchased_on: purchasedOn,
      })
    } catch {
      setError('Could not save this purchase. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
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

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add purchase'}
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
