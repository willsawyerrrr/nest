import { useState, type FormEvent } from 'react'
import { Button, Card, NumberInput, Stack, Text, TextInput } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import { centsToDollars, dollarsToCents } from '../lib/money'

/** The values a super form submits for one member: fund name and current balance. */
export interface SuperFormValues {
  fundName: string
  balanceCents: number
}

interface SuperProfileFormProps {
  member: Member
  initialFundName?: string | null
  initialBalanceCents?: number | null
  onSubmit: (values: SuperFormValues) => void | Promise<void>
}

/** Presentational super editor for one member: fund name and balance. Persistence lives in the caller. */
export function SuperProfileForm({
  member,
  initialFundName,
  initialBalanceCents,
  onSubmit,
}: SuperProfileFormProps) {
  const [fundName, setFundName] = useState(initialFundName ?? '')
  const [balance, setBalance] = useState<number | string>(centsToDollars(initialBalanceCents))
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
        fundName: fundName.trim(),
        balanceCents: dollarsToCents(balance) ?? 0,
      })
      setSaved(true)
    } catch {
      setError('Could not save this super profile. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <Text fw={600}>{member.name}</Text>

        <TextInput
          label="Fund name"
          size="sm"
          placeholder="e.g. AustralianSuper"
          value={fundName}
          onChange={(event) => setFundName(event.currentTarget.value)}
        />

        <NumberInput
          label="Current balance"
          size="sm"
          prefix="$"
          thousandSeparator
          decimalScale={2}
          fixedDecimalScale
          min={0}
          hideControls
          value={balance}
          onChange={setBalance}
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

        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </Stack>
    </Card>
  )
}
