import { useState } from 'react'
import { Checkbox, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileSubmission, TaxResidency } from '../hooks/useTaxProfiles'
import { EnumSelect } from './EnumSelect'
import { FormShell } from './FormShell'

interface TaxProfileFormProps {
  member: Member
  initial?: TaxProfile | undefined
  onSubmit: (submission: TaxProfileSubmission) => void | Promise<void>
  onCancel?: () => void
}

const RESIDENCIES: { value: TaxResidency; label: string }[] = [
  { value: 'resident', label: 'Resident' },
  { value: 'foreign_resident', label: 'Foreign resident' },
]

/**
 * Presentational tax-profile editor for one member: their residency and hospital
 * cover for the financial year, and their date of birth, which belongs to the member
 * rather than the year. Persistence lives in the caller.
 */
export function TaxProfileForm({ member, initial, onSubmit, onCancel }: TaxProfileFormProps) {
  const [residency, setResidency] = useState<TaxResidency>(initial?.residency ?? 'resident')
  const [hasCover, setHasCover] = useState(initial?.has_private_hospital_cover ?? false)
  const [dateOfBirth, setDateOfBirth] = useState(member.date_of_birth)
  const [saved, setSaved] = useState(false)

  const { submitting, error, handleSubmit } = useFormSubmit({
    errorMessage: 'Could not save this tax profile. Please try again.',
    resetOnSuccess: true,
    onStart: () => setSaved(false),
    onSuccess: () => setSaved(true),
    onSubmit,
    buildInput: (): TaxProfileSubmission => ({
      profile: {
        member_id: member.id,
        residency,
        has_private_hospital_cover: hasCover,
      },
      dateOfBirth,
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

      <DateInput
        label="Date of birth"
        size="sm"
        description="Optional. Used for one thing only: your age when a one-off termination payment lands, which sets the rate its concessional part is taxed at. Left blank, the estimate assumes you are below preservation age — the higher rate."
        valueFormat="D MMM YYYY"
        clearable
        value={dateOfBirth}
        onChange={setDateOfBirth}
      />
    </FormShell>
  )
}
