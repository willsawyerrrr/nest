import { useState, type FormEvent } from 'react'
import { Button, Group, Stack, Text } from '@mantine/core'
import type { HelpDebt, HelpDebtInput } from '../hooks/useHelpDebts'
import type { Member } from '../hooks/useMembers'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { AppCard } from './AppCard'
import { EditAction } from './EditAction'
import { MoneyInput } from './MoneyInput'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'

interface HelpDebtScreenProps {
  members: Member[]
  helpDebts: HelpDebt[]
  onSave: (input: HelpDebtInput) => Promise<void>
}

/** One member's HELP balance as a compact read-only row with an Edit affordance. */
function HelpDebtCard({
  member,
  debt,
  onEdit,
}: {
  member: Member
  debt?: HelpDebt
  onEdit: () => void
}) {
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {member.name}
          </Text>
          <MoneyText cents={debt?.balance_cents ?? 0} size="sm" c="dimmed" />
        </Stack>
        <EditAction onClick={onEdit} style={{ flexShrink: 0 }} />
      </Group>
    </AppCard>
  )
}

/** One member's HELP balance editor: a dollar input that upserts on save. */
function MemberHelpDebtForm({
  member,
  initial,
  onSave,
  onCancel,
}: {
  member: Member
  initial?: HelpDebt
  onSave: (input: HelpDebtInput) => Promise<void>
  onCancel: () => void
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
    <AppCard withBorder padding="sm" component="form" onSubmit={handleSubmit}>
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
          <Text role="status" c="positive" size="sm">
            Saved
          </Text>
        )}
        <Group grow>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="default" onClick={onCancel}>
            Cancel
          </Button>
        </Group>
      </Stack>
    </AppCard>
  )
}

/**
 * Presentational HELP-debt manager: one balance per household member, shown as a
 * read-only row that expands into an inline edit form. Each member's outstanding
 * HELP debt feeds the tax estimate and counts as a liability on the Net worth tab.
 * Persistence lives in the caller.
 */
export function HelpDebtScreen({ members, helpDebts, onSave }: HelpDebtScreenProps) {
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const debtForMember = (memberId: string) => helpDebts.find((debt) => debt.member_id === memberId)

  return (
    <PageSection
      title="HELP debt"
      intro="Each member’s outstanding HELP/HECS balance. It drives the compulsory repayment on the Tax tab and counts against household net worth as a liability."
    >
      {members.map((member) =>
        editingMemberId === member.id ? (
          <MemberHelpDebtForm
            key={member.id}
            member={member}
            initial={debtForMember(member.id)}
            onSave={async (input) => {
              await onSave(input)
              setEditingMemberId(null)
            }}
            onCancel={() => setEditingMemberId(null)}
          />
        ) : (
          <HelpDebtCard
            key={member.id}
            member={member}
            debt={debtForMember(member.id)}
            onEdit={() => setEditingMemberId(member.id)}
          />
        ),
      )}
    </PageSection>
  )
}
