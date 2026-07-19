import { useState } from 'react'
import { Badge, Button, Card, Group, Progress, Stack, Text } from '@mantine/core'
import { fortnightlyCents, projectGoal } from '@budget/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal, GoalInput } from '../hooks/useGoals'
import { formatCents } from '../lib/money'
import { formatIsoDate } from '../lib/dates'
import { GoalForm } from './GoalForm'

interface GoalListProps {
  goals: Goal[]
  lines: BudgetLine[]
  onCreate: (input: GoalInput) => Promise<void>
  onUpdate: (id: string, input: GoalInput) => Promise<void>
  onDelete: (id: string) => void
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
  contributionCents,
  onEdit,
  onDelete,
}: {
  goal: Goal
  contributionCents: number
  onEdit: () => void
  onDelete: () => void
}) {
  const projection = projectGoal(
    {
      targetAmountCents: goal.target_amount_cents,
      currentBalanceCents: goal.current_balance_cents,
      targetDate: goal.target_date ?? undefined,
    },
    contributionCents,
    new Date(),
  )

  const percent =
    goal.target_amount_cents > 0
      ? Math.min(100, (goal.current_balance_cents / goal.target_amount_cents) * 100)
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
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text fw={600} style={{ minWidth: 0 }}>
            {goal.name}
          </Text>
          <Badge variant="light" color={status.color}>
            {status.label}
          </Badge>
        </Group>

        <Group justify="space-between" align="baseline" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {formatCents(goal.current_balance_cents)} of {formatCents(goal.target_amount_cents)}
          </Text>
          <Text size="sm" fw={600}>
            {Math.round(percent)}%
          </Text>
        </Group>

        <Progress value={percent} color={status.color} aria-label={`${goal.name} progress`} />

        <Text size="sm">{eta}</Text>
        <Text size="xs" c="dimmed">
          Linked contribution {formatCents(contributionCents)} / fn
        </Text>

        <Group grow>
          <Button variant="light" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="subtle" color="red" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}

/** The household's savings goals with progress and ETA, plus inline add/edit forms. */
export function GoalList({ goals, lines, onCreate, onUpdate, onDelete }: GoalListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const startAdding = () => {
    setEditingId(null)
    setAdding(true)
  }
  const startEditing = (id: string) => {
    setAdding(false)
    setEditingId(id)
  }
  const closeForms = () => {
    setEditingId(null)
    setAdding(false)
  }

  return (
    <Stack gap="sm">
      {goals.length === 0 && !adding && (
        <Text c="dimmed" size="sm">
          No goals yet.
        </Text>
      )}

      {goals.map((goal) =>
        editingId === goal.id ? (
          <GoalForm
            key={goal.id}
            initial={goal}
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
            contributionCents={contributionForGoal(goal.id, lines)}
            onEdit={() => startEditing(goal.id)}
            onDelete={() => onDelete(goal.id)}
          />
        ),
      )}

      {adding ? (
        <GoalForm
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <Button variant="light" fullWidth onClick={startAdding}>
          Add goal
        </Button>
      )}
    </Stack>
  )
}
