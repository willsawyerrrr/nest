import { useState, type FormEvent } from 'react'
import { Button, Card, NumberInput, Stack, Text, TextInput } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import { formatIsoDate } from '../lib/dates'
import { centsToDollars, dollarsToCents, formatCents } from '../lib/money'
import { accruedBalanceCents } from '../lib/super'

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
}

/**
 * Presentational super editor for one member: fund name and balance. The stored
 * balance is a baseline confirmed on a date; this shows the effective balance
 * today (baseline plus modelled contributions accrued since) and treats a save
 * as a true-up that re-confirms the actual balance. Persistence lives in the caller.
 */
export function SuperProfileForm({
  member,
  initialFundName,
  initialBalanceCents,
  balanceAsOf = null,
  netAnnualContributionCents = 0,
  today = new Date(),
  onSubmit,
}: SuperProfileFormProps) {
  const baselineCents = initialBalanceCents ?? 0
  const effectiveCents = accruedBalanceCents(
    baselineCents,
    balanceAsOf,
    netAnnualContributionCents,
    today,
  )
  const accruedCents = effectiveCents - baselineCents

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
  const showAccrual = isTrueUp && accruedCents !== 0

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <Text fw={600}>{member.name}</Text>

        {isTrueUp && (
          <Stack gap={2}>
            <Text size="sm" c="dimmed">
              Estimated balance today
            </Text>
            <Text fw={700} fz="lg">
              {formatCents(effectiveCents)}
            </Text>
            {showAccrual && (
              <Text size="xs" c="dimmed">
                {formatCents(baselineCents)} confirmed on {formatIsoDate(balanceAsOf)} +{' '}
                {formatCents(accruedCents)} accrued from contributions
              </Text>
            )}
            <Text size="xs" c="dimmed">
              Between true-ups this is estimated from your modelled contributions. Enter your
              fund&rsquo;s actual balance to true it up.
            </Text>
          </Stack>
        )}

        <TextInput
          label="Fund name"
          size="sm"
          placeholder="e.g. AustralianSuper"
          value={fundName}
          onChange={(event) => setFundName(event.currentTarget.value)}
        />

        <NumberInput
          label={isTrueUp ? 'Actual balance today' : 'Current balance'}
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
          {submitting ? 'Saving…' : isTrueUp ? 'Update actual balance' : 'Save'}
        </Button>
      </Stack>
    </Card>
  )
}
