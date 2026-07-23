import { useState, type FormEvent } from 'react'
import { Button, Card, Group, Stack, Text, TextInput } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { accruedBalanceCents } from '../lib/super'
import { MoneyInput } from './MoneyInput'

/** The values a super form submits for one member: fund name and the confirmed actual balance. */
export interface SuperFormValues {
  fundName: string
  balanceCents: number
}

interface SuperProfileFormProps {
  member: Member
  initialFundName?: string | null
  /** The last confirmed baseline balance for the member's linked account, in cents. */
  initialBalanceCents?: number | null
  /** The date that baseline was confirmed (a true-up); null when never confirmed. */
  balanceAsOf?: string | null
  /** The member's modelled net annual contribution, accrued onto the baseline. */
  netAnnualContributionCents?: number
  /** Injectable clock for a deterministic effective balance; defaults to now. */
  today?: Date
  onSubmit: (values: SuperFormValues) => void | Promise<void>
  onCancel?: () => void
}

/**
 * Presentational super editor for one member: fund name and balance. The stored
 * balance is a baseline confirmed on a date; the input prefills with the effective
 * balance today (baseline plus modelled contributions accrued since) and treats a
 * save as a true-up that re-confirms the actual balance. Persistence lives in the
 * caller.
 */
export function SuperProfileForm({
  member,
  initialFundName,
  initialBalanceCents,
  balanceAsOf = null,
  netAnnualContributionCents = 0,
  today = new Date(),
  onSubmit,
  onCancel,
}: SuperProfileFormProps) {
  const baselineCents = initialBalanceCents ?? 0
  const effectiveCents = accruedBalanceCents(
    baselineCents,
    balanceAsOf,
    netAnnualContributionCents,
    today,
  )

  const [fundName, setFundName] = useState(initialFundName ?? '')
  const [balance, setBalance] = useState<number | string>(
    initialBalanceCents == null ? '' : centsToDollars(effectiveCents),
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

  const isTrueUp = balanceAsOf !== null

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <Text fw={600}>{member.name}</Text>

        {isTrueUp && (
          <Text size="xs" c="dimmed">
            Between true-ups the balance is estimated from your modelled contributions. Enter your
            fund&rsquo;s actual balance to true it up.
          </Text>
        )}

        <TextInput
          label="Fund name"
          size="sm"
          placeholder="e.g. AustralianSuper"
          value={fundName}
          onChange={(event) => setFundName(event.currentTarget.value)}
        />

        <MoneyInput
          label={isTrueUp ? 'Actual balance today' : 'Current balance'}
          size="sm"
          min={0}
          hideControls
          value={balance}
          onChange={setBalance}
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

        {onCancel ? (
          <Group grow>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isTrueUp ? 'Update actual balance' : 'Save'}
            </Button>
            <Button type="button" variant="default" onClick={onCancel}>
              Cancel
            </Button>
          </Group>
        ) : (
          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Saving…' : isTrueUp ? 'Update actual balance' : 'Save'}
          </Button>
        )}
      </Stack>
    </Card>
  )
}
