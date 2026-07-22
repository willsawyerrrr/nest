import { useState, type FormEvent } from 'react'
import { Button, Card, Stack, Text, Title } from '@mantine/core'
import type { HelpDebt, HelpDebtInput } from '../hooks/useHelpDebts'
import type { Member } from '../hooks/useMembers'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { MoneyInput } from './MoneyInput'

interface HelpDebtScreenProps {
  members: Member[]
  helpDebts: HelpDebt[]
  onSave: (input: HelpDebtInput) => Promise<void>
}

/** One member's HELP balance editor: a dollar input that upserts on save. */
function MemberHelpDebtForm({
  member,
  initial,
  onSave,
}: {
  member: Member
  initial?: HelpDebt
  onSave: (input: HelpDebtInput) => Promise<void>
}) {
  const [balance, setBalance] = useState<number | string>(centsToDollars(initial?.balance_cents))
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setSaved(false)
    setError(null)
    try {
      await onSave({ member_id: member.id, balance_cents: dollarsToCents(balance) ?? 0 })
      setSaved(true)
    } catch {
      setError('Could not save this HELP balance. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <Text fw={600}>{member.name}</Text>
        <MoneyInput
          label="HELP debt"
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
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </Stack>
    </Card>
  )
}

/**
 * Presentational HELP-debt manager: one balance editor per household member.
 * Each member's outstanding HELP debt feeds the tax estimate and counts as a
 * liability on the Net worth tab. Persistence lives in the caller.
 */
export function HelpDebtScreen({ members, helpDebts, onSave }: HelpDebtScreenProps) {
  return (
    <Stack gap="sm">
      <Title order={2} visibleFrom="sm">
        HELP debt
      </Title>
      <Text c="dimmed" size="sm">
        Each member&rsquo;s outstanding HELP/HECS balance. It drives the compulsory repayment on the
        Tax tab and counts against household net worth as a liability.
      </Text>
      {members.map((member) => (
        <MemberHelpDebtForm
          key={member.id}
          member={member}
          initial={helpDebts.find((debt) => debt.member_id === member.id)}
          onSave={onSave}
        />
      ))}
    </Stack>
  )
}
