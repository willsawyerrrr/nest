import { useState } from 'react'
import { Checkbox, Text } from '@mantine/core'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileInput, TaxResidency } from '../hooks/useTaxProfiles'
import { EnumSelect } from './EnumSelect'
import { FormShell } from './FormShell'

interface TaxProfileFormProps {
  member: Member
  initial?: TaxProfile
  onSubmit: (input: TaxProfileInput) => void | Promise<void>
  onCancel?: () => void
}

const RESIDENCIES: { value: TaxResidency; label: string }[] = [
  { value: 'resident', label: 'Resident' },
  { value: 'foreign_resident', label: 'Foreign resident' },
]

/** Presentational tax-profile editor for one member. Persistence lives in the caller. */
export function TaxProfileForm({ member, initial, onSubmit, onCancel }: TaxProfileFormProps) {
  const [residency, setResidency] = useState<TaxResidency>(initial?.residency ?? 'resident')
  const [hasCover, setHasCover] = useState(initial?.has_private_hospital_cover ?? false)
  const [saved, setSaved] = useState(false)

  const { submitting, error, handleSubmit } = useFormSubmit({
    errorMessage: 'Could not save this tax profile. Please try again.',
    resetOnSuccess: true,
    onStart: () => setSaved(false),
    onSuccess: () => setSaved(true),
    onSubmit,
    buildInput: (): TaxProfileInput => ({
      member_id: member.id,
      residency,
      has_private_hospital_cover: hasCover,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      submitLabel="Save"
      onCancel={onCancel}
      status={
        saved && !error ? (
          <Text role="status" c="positive" size="sm">
            Saved
          </Text>
        ) : null
      }
    >
      <Text fw={600}>{member.name}</Text>

      <EnumSelect
        label="Residency"
        size="sm"
        data={RESIDENCIES}
        value={residency}
        onChange={(value) => value && setResidency(value)}
        allowDeselect={false}
      />

      <Checkbox
        label="Private hospital cover"
        checked={hasCover}
        onChange={(event) => setHasCover(event.currentTarget.checked)}
      />
    </FormShell>
  )
}
