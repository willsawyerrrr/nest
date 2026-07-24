import { useState } from 'react'
import { Text, TextInput } from '@mantine/core'
import { accruedBalanceCents } from '@nest/plan'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { Member } from '../hooks/useMembers'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { FormShell } from './FormShell'
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
  const [saved, setSaved] = useState(false)

  const { submitting, error, handleSubmit } = useFormSubmit({
    errorMessage: 'Could not save this super profile. Please try again.',
    resetOnSuccess: true,
    onStart: () => setSaved(false),
    onSuccess: () => setSaved(true),
    onSubmit,
    buildInput: (): SuperFormValues => ({
      fundName: fundName.trim(),
      balanceCents: dollarsToCents(balance) ?? 0,
    }),
  })

  const isTrueUp = balanceAsOf !== null

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      submitLabel={isTrueUp ? 'Update actual balance' : 'Save'}
      onCancel={onCancel}
      status={
        saved && !error ? (
          <Text role="status" c="green" size="sm">
            Saved
          </Text>
        ) : null
      }
    >
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
    </FormShell>
  )
}
