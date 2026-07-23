import { Badge, Group, Progress, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { fortnightlyCents, projectGoal } from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type { Goal, GoalInput } from '../hooks/useGoals'
import { useInlineEditing } from '../hooks/useInlineEditing'
import type { Saver } from '../hooks/useSavers'
import { formatIsoDate } from '../lib/dates'
import { formatCents, formatPerFortnight } from '../lib/money'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
import { FortnightlyAmount } from './FortnightlyAmount'
import { GoalForm } from './GoalForm'
import { ListRow } from './ListRow'

interface GoalListProps {
  goals: Goal[]
  lines: BudgetLine[]
  savers: Saver[]
  onCreate: (input: GoalInput) => Promise<void>
  onUpdate: (id: string, input: GoalInput) => Promise<void>
  onDelete: (id: string) => void
}

/** The account a goal links to, when set and still visible to the household. */
function linkedSaver(goal: Goal, savers: Saver[]): Saver | undefined {
  return goal.linked_account_id === null
    ? undefined
    : savers.find((saver) => saver.id === goal.linked_account_id)
}

/** The fortnightly contribution funding a goal: the sum of its linked budget lines. */
function contributionForGoal(goalId: string, lines: BudgetLine[]): number {
  return lines
    .filter((line) => line.goal_id === goalId)
    .reduce((total, line) => total + fortnightlyCents(line.amount_cents, line.frequency), 0)
}

function pluraliseFortnights(count: number): string {
  return `${count} ${count === 1 ? 'fortnight' : 'fortnights'}`
}

/** A goal's derived display: its effective balance, progress, status flag, and ETA text. */
interface GoalDisplay {
  currentBalanceCents: number
  percent: number
  status: { label: string; color: string }
  eta: string
}

/** Derives a goal's progress, status flag, and ETA from its target and contribution. */
function goalDisplay(goal: Goal, saver: Saver | undefined, contributionCents: number): GoalDisplay {
  // A linked saver's synced balance overrides the manually entered one.
  const currentBalanceCents = saver ? saver.balance_cents : goal.current_balance_cents

  const projection = projectGoal(
    {
      targetAmountCents: goal.target_amount_cents,
      currentBalanceCents,
      targetDate: goal.target_date ?? undefined,
    },
    contributionCents,
    new Date(),
  )

  const percent =
    goal.target_amount_cents > 0
      ? Math.min(100, (currentBalanceCents / goal.target_amount_cents) * 100)
      : 100

  let status: { label: string; color: string }
  let eta: string
  if (projection.alreadyMet) {
    status = { label: 'Reached', color: 'positive' }
    eta = 'Goal reached.'
  } else if (goal.target_date !== null) {
    const required = projection.requiredFortnightlyContributionCents ?? 0
    const onTrack = contributionCents >= required
    status = onTrack
      ? { label: 'On track', color: 'positive' }
      : { label: 'Behind', color: 'warning' }
    eta = `By ${formatIsoDate(goal.target_date)} needs ${formatPerFortnight(required)}${
      onTrack ? '' : ` (contributing ${formatPerFortnight(contributionCents)})`
    }`
  } else if (
    projection.fortnightsToTarget !== null &&
    projection.projectedCompletionDate !== null
  ) {
    status = { label: 'On track', color: 'positive' }
    eta = `${pluraliseFortnights(projection.fortnightsToTarget)} — ${formatIsoDate(
      projection.projectedCompletionDate,
    )}`
  } else {
    status = { label: 'No ETA', color: 'gray' }
    eta = 'Link a savings item to project an ETA.'
  }

  return { currentBalanceCents, percent, status, eta }
}

interface GoalItemProps {
  goal: Goal
  saver: Saver | undefined
  contributionCents: number
  onEdit: () => void
  onDelete: () => void
}

/**
 * One goal as a dense table-like row for desktop: the name grows with its status
 * flag beside it, then percent, a progress bar, and the fortnightly contribution
 * right-aligned in fixed columns, the controls at the end, and the ETA on a
 * dimmed caption line.
 */
function GoalRow({ goal, saver, contributionCents, onEdit, onDelete }: GoalItemProps) {
  const { percent, status, eta } = goalDisplay(goal, saver, contributionCents)
  const caption = saver ? `${eta} · From Up saver ${saver.name}` : eta
  return (
    <ListRow caption={caption}>
      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate>
          {goal.name}
        </Text>
        <Badge size="xs" variant="light" color={status.color}>
          {status.label}
        </Badge>
      </Group>
      <Text size="sm" fw={600} ta="right" style={{ width: '3rem', flexShrink: 0 }}>
        {Math.round(percent)}%
      </Text>
      <Progress
        value={percent}
        color={status.color}
        size="sm"
        aria-label={`${goal.name} progress`}
        style={{ width: '6rem', flexShrink: 0 }}
      />
      <FortnightlyAmount
        cents={contributionCents}
        justify="flex-end"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One goal as a compact bordered card for mobile: progress toward its target and its ETA. */
function GoalCard({ goal, saver, contributionCents, onEdit, onDelete }: GoalItemProps) {
  const { currentBalanceCents, percent, status, eta } = goalDisplay(goal, saver, contributionCents)
  return (
    <AppCard withBorder padding="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="center" wrap="nowrap" gap="sm">
          <Text fw={600} size="sm" truncate style={{ minWidth: 0 }}>
            {goal.name}
          </Text>
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Badge size="xs" variant="light" color={status.color}>
              {status.label}
            </Badge>
            <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
          </Group>
        </Group>

        <Group justify="space-between" align="baseline" wrap="nowrap">
          <Text size="xs" c="dimmed">
            {formatCents(currentBalanceCents)} of {formatCents(goal.target_amount_cents)}
          </Text>
          <Text size="xs" fw={600}>
            {Math.round(percent)}%
          </Text>
        </Group>

        <Progress
          value={percent}
          color={status.color}
          size="sm"
          aria-label={`${goal.name} progress`}
        />

        <Text size="xs">{eta}</Text>
        {saver && (
          <Text size="xs" c="dimmed">
            From Up saver {saver.name}
          </Text>
        )}
        {contributionCents > 0 && (
          <Text size="xs" c="dimmed">
            Linked contribution {formatPerFortnight(contributionCents)}
          </Text>
        )}
      </Stack>
    </AppCard>
  )
}

/**
 * A single goal, rendered as a dense table-like row from the `sm` breakpoint up
 * and as a compact bordered card below it.
 */
function GoalItem(props: GoalItemProps) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <GoalRow {...props} /> : <GoalCard {...props} />
}

/** The household's savings goals with progress and ETA, plus inline add/edit forms. */
export function GoalList({ goals, lines, savers, onCreate, onUpdate, onDelete }: GoalListProps) {
  const { editingId, adding, startAdding, startEditing, close: closeForms } = useInlineEditing()
  const { confirm, modal } = useConfirmDelete()

  // Goals with an active linked contribution lead, each partition keeping its original order.
  const funded = goals.filter((goal) => contributionForGoal(goal.id, lines) > 0)
  const unfunded = goals.filter((goal) => contributionForGoal(goal.id, lines) === 0)
  const orderedGoals = [...funded, ...unfunded]

  return (
    <Stack gap="sm">
      {goals.length === 0 && !adding && <EmptyState>No goals yet.</EmptyState>}

      {orderedGoals.map((goal) =>
        editingId === goal.id ? (
          <GoalForm
            key={goal.id}
            initial={goal}
            savers={savers}
            onSubmit={async (input) => {
              await onUpdate(goal.id, input)
              closeForms()
            }}
            onCancel={closeForms}
          />
        ) : (
          <GoalItem
            key={goal.id}
            goal={goal}
            saver={linkedSaver(goal, savers)}
            contributionCents={contributionForGoal(goal.id, lines)}
            onEdit={() => startEditing(goal.id)}
            onDelete={() =>
              confirm({
                title: 'Delete goal?',
                itemLabel: goal.name,
                onConfirm: () => onDelete(goal.id),
              })
            }
          />
        ),
      )}

      {adding ? (
        <GoalForm
          savers={savers}
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <AddButton label="Add goal" onClick={() => startAdding(true)} />
      )}

      {modal}
    </Stack>
  )
}
