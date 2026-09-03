import { useState } from 'react'
import { Select, TextInput } from '@mantine/core'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Member } from '../hooks/useMembers'
import type { WishlistItem, WishlistItemInput } from '../hooks/useWishlist'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormShell } from './FormShell'
import { MoneyInput } from './MoneyInput'

interface WishlistFormProps {
  initial?: WishlistItem | undefined
  /** The household's members, offered as the optional "whose wish" tag. */
  members: Member[]
  onSubmit: (input: WishlistItemInput) => void | Promise<void>
  onCancel?: () => void
}

/** Presentational add/edit form for a single wishlist item. Persistence lives in the caller. */
export function WishlistForm({ initial, members, onSubmit, onCancel }: WishlistFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [memberId, setMemberId] = useState<string | null>(initial?.member_id ?? null)
  const [note, setNote] = useState(initial?.note ?? '')

  const canSubmit = name.trim() !== '' && amount !== '' && Number(amount) > 0

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not save this wishlist item. Please try again.',
    onSubmit,
    buildInput: (): WishlistItemInput => ({
      name: name.trim(),
      amount_cents: dollarsToCents(amount) ?? 0,
      member_id: memberId,
      note: note.trim() === '' ? null : note.trim(),
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      editing={Boolean(initial)}
      addLabel="wishlist item"
      onCancel={onCancel}
    >
      <TextInput
        label="Name"
        size="sm"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />

      <MoneyInput
        label="Rough cost"
        size="sm"
        min={0}
        hideControls
        value={amount}
        onChange={setAmount}
      />

      {members.length > 0 && (
        <Select
          label="Whose wish"
          size="sm"
          description="Optional. A tag for reporting only — money stays pooled."
          placeholder="No one in particular"
          clearable
          data={members.map((member) => ({ value: member.id, label: member.name }))}
          value={memberId}
          onChange={setMemberId}
        />
      )}

      <TextInput
        label="Note"
        size="sm"
        description="Optional."
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
    </FormShell>
  )
}
