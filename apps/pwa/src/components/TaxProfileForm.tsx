import { useState, type FormEvent } from 'react'
import { Button, Card, Checkbox, NumberInput, Select, Stack, Text, Title } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileInput, TaxResidency } from '../hooks/useTaxProfiles'
import { centsToDollars, dollarsToCents } from '../lib/money'

interface TaxProfileFormProps {
  member: Member
  initial?: TaxProfile
  onSubmit: (input: TaxProfileInput) => void | Promise<void>
}

const RESIDENCIES: { value: TaxResidency; label: string }[] = [
  { value: 'resident', label: 'Resident' },
  { value: 'foreign_resident', label: 'Foreign resident' },
]

/** Presentational tax-profile editor for one member. Persistence lives in the caller. */
export function TaxProfileForm({ member, initial, onSubmit }: TaxProfileFormProps) {
  const [residency, setResidency] = useState<TaxResidency>(initial?.residency ?? 'resident')
  const [hasCover, setHasCover] = useState(initial?.has_private_hospital_cover ?? false)
  const [helpDebt, setHelpDebt] = useState<number | string>(
    centsToDollars(initial?.help_debt_cents),
  )
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setSaved(false)
    setError(null)
    try {
      await onSubmit({
        member_id: member.id,
        residency,
        has_private_hospital_cover: hasCover,
        help_debt_cents: dollarsToCents(helpDebt) ?? 0,
      })
      setSaved(true)
    } catch {
      setError('Could not save this tax profile. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="md" component="form" onSubmit={handleSubmit}>
      <Stack gap="md">
        <Title order={3}>{member.name}</Title>

        <Select
          label="Residency"
          data={RESIDENCIES}
          value={residency}
          onChange={(value) => value && setResidency(value as TaxResidency)}
          allowDeselect={false}
        />

        <Checkbox
          label="Private hospital cover"
          checked={hasCover}
          onChange={(event) => setHasCover(event.currentTarget.checked)}
        />

        <NumberInput
          label="HELP debt"
          prefix="$"
          thousandSeparator
          decimalScale={2}
          min={0}
          hideControls
          value={helpDebt}
          onChange={setHelpDebt}
        />

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}
        {saved && !error && (
          <Text role="status" c="green" size="sm">
            Saved
          </Text>
        )}

        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </Stack>
    </Card>
  )
}
