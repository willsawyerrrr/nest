import { useState, type FormEvent } from 'react'
import { Button, Card, Checkbox, Group, NumberInput, Select, Stack, Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileInput, TaxResidency } from '../hooks/useTaxProfiles'
import { centsToDollars, dollarsToCents } from '../lib/money'

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
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <Text fw={600}>{member.name}</Text>

        <Select
          label="Residency"
          size="sm"
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
          size="sm"
          prefix="$"
          thousandSeparator
          decimalScale={2}
          fixedDecimalScale
          min={0}
          hideControls
          value={helpDebt}
          onChange={setHelpDebt}
        />

        {error && (
          <Text role="alert" c="negative" size="sm">
            {error}
          </Text>
        )}
        {saved && !error && (
          <Text role="status" c="positive" size="sm">
            Saved
          </Text>
        )}

        {onCancel ? (
          <Group grow>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="default" onClick={onCancel}>
              Cancel
            </Button>
          </Group>
        ) : (
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        )}
      </Stack>
    </Card>
  )
}
