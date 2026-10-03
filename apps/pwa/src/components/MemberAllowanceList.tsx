import { Badge, Group, Progress, Stack, Text, Title } from '@mantine/core'
import { summariseAllowances, type AllowanceSummary } from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { useInlineEditing } from '../hooks/useInlineEditing'
import type { MemberAllowance, MemberAllowanceInput } from '../hooks/useMemberAllowances'
import { allowanceName, toPlanAllowance, toPlanDrawableLine } from '../lib/allowances'
import { formatFrequency } from '../lib/frequency'
import { formatPerFortnight, signMoneyColor } from '../lib/money'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { MemberAllowanceForm } from './MemberAllowanceForm'
import { MoneyText } from './MoneyText'

interface MemberAllowanceListProps {
  members: { id: string; name: string }[]
  allowances: MemberAllowance[]
  /** Every budget line, so each allowance can total what is drawn from it. */
  lines: BudgetLine[]
  /** The household's accounts, offered as an allowance's funding account. */
  accounts?: { id: string; name: string }[]
  onCreate: (input: MemberAllowanceInput) => Promise<void>
  onUpdate: (id: string, input: MemberAllowanceInput) => Promise<void>
  onDelete: (id: string) => void
}

/** One member's allowance: its amount and cadence, what is drawn from it, and what is left. */
function AllowanceCard({
  allowance,
  memberName,
  summary,
  onEdit,
  onDelete,
}: {
  allowance: MemberAllowance
  memberName: string
  summary: AllowanceSummary
  onEdit: () => void
  onDelete: () => void
}) {
  const { overdrawn, drawn, remaining } = summary
  const share = summary.allowance.fortnightlyCents
  const used = share === 0 ? 100 : Math.min(100, (drawn.fortnightlyCents / share) * 100)
  return (
    <AppCard withBorder padding="xs">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={600} size="sm" truncate>
                {allowanceName(memberName)}
              </Text>
              {overdrawn && (
                <Badge size="xs" color="negative">
                  Overdrawn
                </Badge>
              )}
            </Group>
            <Group gap={6} wrap="nowrap">
              <MoneyText cents={allowance.amount_cents} size="xs" c="dimmed" />
              <Badge size="xs" variant="default">
                {formatFrequency(allowance.frequency, allowance.interval_count)}
              </Badge>
              <Text size="xs" c="dimmed">
                {formatPerFortnight(summary.allowance.fortnightlyCents)}
              </Text>
            </Group>
          </Stack>
          <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
          </Group>
        </Group>
        <Progress
          value={used}
          color={overdrawn ? 'negative' : 'positive'}
          size="sm"
          aria-label={`${allowanceName(memberName)} drawn`}
        />
        <Group justify="space-between" gap="sm">
          <Text size="xs" c="dimmed">
            Drawn {formatPerFortnight(drawn.fortnightlyCents)}
          </Text>
          <Group gap={4}>
            <Text size="xs" c="dimmed">
              {overdrawn ? 'Overdrawn by' : 'Left'}
            </Text>
            <MoneyText
              cents={Math.abs(remaining.fortnightlyCents)}
              size="xs"
              fw={600}
              {...(overdrawn && { c: signMoneyColor(-1) })}
            />
          </Group>
        </Group>
      </Stack>
    </AppCard>
  )
}

/**
 * Each household member's optional spending allowance: an amount a person can
 * spend on themselves, with the budget items drawn from it counted against it and
 * what is left (or how far it is overdrawn) alongside. Money stays pooled — the
 * allowance is a budgeting envelope, not a separate account.
 */
export function MemberAllowanceList({
  members,
  allowances,
  lines,
  accounts = [],
  onCreate,
  onUpdate,
  onDelete,
}: MemberAllowanceListProps) {
  const { editingId, adding, startAdding, startEditing, close } = useInlineEditing<string>()
  const { confirm, modal } = useConfirmDelete()
  const summaries = new Map(
    summariseAllowances(lines.map(toPlanDrawableLine), allowances.map(toPlanAllowance)).map(
      (summary) => [summary.memberId, summary],
    ),
  )

  return (
    <Stack gap="xs">
      <Title order={3} size="h5">
        Spending allowances
      </Title>
      <Text size="xs" c="dimmed">
        An optional amount each person can spend on themselves. Items drawn from it count against
        it, not on top of it.
      </Text>
      {members.map((member) => {
        const allowance = allowances.find((candidate) => candidate.member_id === member.id)
        const summary = summaries.get(member.id)
        if (allowance && summary && editingId !== allowance.id) {
          return (
            <AllowanceCard
              key={member.id}
              allowance={allowance}
              memberName={member.name}
              summary={summary}
              onEdit={() => startEditing(allowance.id)}
              onDelete={() =>
                confirm({
                  title: 'Remove allowance?',
                  itemLabel: allowanceName(member.name),
                  onConfirm: () => onDelete(allowance.id),
                })
              }
            />
          )
        }
        if (allowance || adding === member.id) {
          return (
            <MemberAllowanceForm
              key={member.id}
              memberId={member.id}
              memberName={member.name}
              initial={allowance}
              accounts={accounts}
              onSubmit={async (input) => {
                await (allowance ? onUpdate(allowance.id, input) : onCreate(input))
                close()
              }}
              onCancel={close}
            />
          )
        }
        return (
          <AddButton
            key={member.id}
            label={`Set ${member.name}’s allowance`}
            onClick={() => startAdding(member.id)}
          />
        )
      })}
      {modal}
    </Stack>
  )
}
