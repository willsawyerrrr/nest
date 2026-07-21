import { Badge, Button, Card, Group, Progress, Stack, Text } from '@mantine/core'
import { fortnightlyCents, projectGoal } from '@nest/plan'
import { useInlineEditing } from '../hooks/useInlineEditing'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal, GoalInput } from '../hooks/useGoals'
import type { Saver } from '../hooks/useSavers'
import { formatCents } from '../lib/money'
import { formatIsoDate } from '../lib/dates'
import { EditDeleteActions } from './EditDeleteActions'
import { GoalForm } from './GoalForm'

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

/** One goal's display card: progress toward its target and the ETA to reach it. */
function GoalCard({
  goal,
  saver,
  contributionCents,
  onEdit,
  onDelete,
}: {
  goal: Goal
  saver: Saver | undefined
  contributionCents: number
  onEdit: () => void
  onDelete: () => void
}) {
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
    status = { label: 'Reached', color: 'teal' }
    eta = 'Goal reached.'
  } else if (goal.target_date !== null) {
    const required = projection.requiredFortnightlyContributionCents ?? 0
    const onTrack = contributionCents >= required
    status = onTrack ? { label: 'On track', color: 'teal' } : { label: 'Behind', color: 'orange' }
    eta = `By ${formatIsoDate(goal.target_date)} needs ${formatCents(required)}/fn${
      onTrack ? '' : ` (contributing ${formatCents(contributionCents)}/fn)`
    }`
  } else if (
    projection.fortnightsToTarget !== null &&
    projection.projectedCompletionDate !== null
  ) {
    status = { label: 'On track', color: 'teal' }
    eta = `${pluraliseFortnights(projection.fortnightsToTarget)} — ${formatIsoDate(
      projection.projectedCompletionDate,
    )}`
  } else {
    status = { label: 'No ETA', color: 'gray' }
    eta = 'Link a savings line to project an ETA.'
  }

  return (
    <Card withBorder radius="md" p="sm">
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
            Linked contribution {formatCents(contributionCents)} / fn
          </Text>
        )}
      </Stack>
    </Card>
  )
}

/** The household's savings goals with progress and ETA, plus inline add/edit forms. */
export function GoalList({ goals, lines, savers, onCreate, onUpdate, onDelete }: GoalListProps) {
  const { editingId, adding, startAdding, startEditing, close: closeForms } = useInlineEditing()

  // Goals with an active linked contribution lead, each partition keeping its original order.
  const funded = goals.filter((goal) => contributionForGoal(goal.id, lines) > 0)
  const unfunded = goals.filter((goal) => contributionForGoal(goal.id, lines) === 0)
  const orderedGoals = [...funded, ...unfunded]

  return (
    <Stack gap="sm">
      {goals.length === 0 && !adding && (
        <Text c="dimmed" size="sm">
          No goals yet.
        </Text>
      )}

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
          <GoalCard
            key={goal.id}
            goal={goal}
            saver={linkedSaver(goal, savers)}
            contributionCents={contributionForGoal(goal.id, lines)}
            onEdit={() => startEditing(goal.id)}
            onDelete={() => onDelete(goal.id)}
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
        <Button variant="light" fullWidth onClick={() => startAdding(true)}>
          Add goal
        </Button>
      )}
    </Stack>
  )
}
