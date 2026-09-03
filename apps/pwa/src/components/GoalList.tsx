import type { ReactNode } from 'react'
import { Badge, Group, Progress, Stack, Text } from '@mantine/core'
import { fortnightlyCents, projectGoal, type GoalProjection } from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal, GoalInput } from '../hooks/useGoals'
import { useIsWide } from '../hooks/useIsWide'
import type { Saver } from '../hooks/useSavers'
import { formatIsoDate } from '../lib/dates'
import { formatCents, formatPerFortnight } from '../lib/money'
import { AppCard } from './AppCard'
import { ComparedAmount, ComparedDate } from './ComparedAmount'
import { DeletedInUpBadge } from './DeletedInUpBadge'
import { EditableList } from './EditableList'
import { EditDeleteActions } from './EditDeleteActions'
import { FortnightlyAmount } from './FortnightlyAmount'
import { GoalForm } from './GoalForm'
import { ListRow } from './ListRow'

interface GoalListProps {
  goals: Goal[]
  lines: BudgetLine[]
  savers: Saver[]
  /** The real goals a planning-mode comparison reads; defaults to `goals` (no delta). */
  baselineGoals?: Goal[]
  /** The real budget lines a planning-mode comparison reads; defaults to `lines` (no delta). */
  baselineLines?: BudgetLine[]
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

/** A goal's derived display: its effective balance, progress, status flag, and ETA. */
interface GoalDisplay {
  currentBalanceCents: number
  percent: number
  status: { label: string; color: string }
  /**
   * The ETA line. Where a `baseline` projection was passed and the sandbox has
   * moved the figure, the required contribution (dated goal) or the projected
   * completion date (undated goal) reads `real → proposed (±Δ)`.
   */
  eta: ReactNode
}

/** A goal's raw projection from its effective balance and fortnightly contribution. */
function goalProjection(
  goal: Goal,
  saver: Saver | undefined,
  contributionCents: number,
): GoalProjection {
  // A linked saver's synced balance overrides the manually entered one.
  const currentBalanceCents = saver ? saver.balance_cents : goal.current_balance_cents
  return projectGoal(
    {
      targetAmountCents: goal.target_amount_cents,
      currentBalanceCents,
      ...(goal.target_date != null && { targetDate: goal.target_date }),
    },
    contributionCents,
    new Date(),
  )
}

/**
 * Derives a goal's progress, status flag, and ETA from its target and
 * contribution. `baseline`, when given, is the same projection from the real
 * rows: the ETA line then shows what the sandbox edit moved.
 */
function goalDisplay(
  goal: Goal,
  saver: Saver | undefined,
  contributionCents: number,
  baseline?: GoalProjection,
): GoalDisplay {
  // A linked saver's synced balance overrides the manually entered one.
  const currentBalanceCents = saver ? saver.balance_cents : goal.current_balance_cents

  const projection = goalProjection(goal, saver, contributionCents)

  const percent =
    goal.target_amount_cents > 0
      ? Math.min(100, (currentBalanceCents / goal.target_amount_cents) * 100)
      : 100

  let status: { label: string; color: string }
  let eta: ReactNode
  if (projection.alreadyMet) {
    status = { label: 'Reached', color: 'positive' }
    eta = 'Goal reached.'
  } else if (goal.target_date !== null) {
    const required = projection.requiredFortnightlyContributionCents ?? 0
    const onTrack = contributionCents >= required
    status = onTrack
      ? { label: 'On track', color: 'positive' }
      : { label: 'Behind', color: 'warning' }
    const suffix = onTrack ? '' : ` (contributing ${formatPerFortnight(contributionCents)})`
    const baselineRequired = baseline?.requiredFortnightlyContributionCents ?? required
    const lead = `By ${formatIsoDate(goal.target_date)} needs `
    eta =
      baselineRequired === required ? (
        `${lead}${formatPerFortnight(required)}${suffix}`
      ) : (
        <>
          {lead}
          <ComparedAmount span baselineCents={baselineRequired} proposedCents={required} />
          {` / fn${suffix}`}
        </>
      )
  } else if (
    projection.fortnightsToTarget !== null &&
    projection.projectedCompletionDate !== null
  ) {
    status = { label: 'On track', color: 'positive' }
    const completionIso = projection.projectedCompletionDate
    const baselineIso = baseline?.projectedCompletionDate ?? completionIso
    const lead = `${pluraliseFortnights(projection.fortnightsToTarget)} — `
    eta =
      baselineIso === completionIso ? (
        `${lead}${formatIsoDate(completionIso)}`
      ) : (
        <>
          {lead}
          <ComparedDate span baselineIso={baselineIso} proposedIso={completionIso} />
        </>
      )
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
  /** The real fortnightly contribution funding the goal, for the planning-mode delta. */
  baselineContributionCents: number
  /** The goal's projection from the real rows, for the ETA delta. */
  baselineProjection: GoalProjection
  onEdit: () => void
  onDelete: () => void
}

/**
 * One goal as a dense table-like row for desktop: the name grows with its status
 * flag beside it, then percent, a progress bar, and the fortnightly contribution
 * right-aligned in fixed columns, the controls at the end, and the ETA on a
 * dimmed caption line.
 */
function GoalRow({
  goal,
  saver,
  contributionCents,
  baselineContributionCents,
  baselineProjection,
  onEdit,
  onDelete,
}: GoalItemProps) {
  const { percent, status, eta } = goalDisplay(goal, saver, contributionCents, baselineProjection)
  const saverDeleted = Boolean(saver?.deleted_from_source_at)
  const caption = (
    <Text size="xs" c="dimmed" component="div">
      {eta}
      {saver &&
        ` · From Up saver ${saver.name}${saverDeleted ? ' — deleted in Up, relink this goal' : ''}`}
    </Text>
  )
  return (
    <ListRow caption={caption}>
      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate>
          {goal.name}
        </Text>
        <Badge size="xs" variant="light" color={status.color}>
          {status.label}
        </Badge>
        {saverDeleted && <DeletedInUpBadge />}
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
        baselineCents={baselineContributionCents}
        justify="flex-end"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One goal as a compact bordered card for mobile: progress toward its target and its ETA. */
function GoalCard({
  goal,
  saver,
  contributionCents,
  baselineProjection,
  onEdit,
  onDelete,
}: GoalItemProps) {
  const { currentBalanceCents, percent, status, eta } = goalDisplay(
    goal,
    saver,
    contributionCents,
    baselineProjection,
  )
  return (
    <AppCard withBorder padding="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="center" wrap="nowrap" gap="sm">
          <Text fw={600} size="sm" truncate style={{ minWidth: 0 }}>
            {goal.name}
          </Text>
          <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
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
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed">
              From Up saver {saver.name}
            </Text>
            {saver.deleted_from_source_at && <DeletedInUpBadge />}
          </Group>
        )}
        {saver?.deleted_from_source_at && (
          <Text size="xs" c="dimmed">
            This saver was deleted in Up. Relink the goal to a current saver.
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
  const wide = useIsWide()
  return wide ? <GoalRow {...props} /> : <GoalCard {...props} />
}

/** The household's savings goals with progress and ETA, plus inline add/edit forms. */
export function GoalList({
  goals,
  lines,
  savers,
  baselineGoals = goals,
  baselineLines = lines,
  onCreate,
  onUpdate,
  onDelete,
}: GoalListProps) {
  // Goals with an active linked contribution lead, each partition keeping its original order.
  const funded = goals.filter((goal) => contributionForGoal(goal.id, lines) > 0)
  const unfunded = goals.filter((goal) => contributionForGoal(goal.id, lines) === 0)
  const orderedGoals = [...funded, ...unfunded]

  const baselineGoalById = new Map(baselineGoals.map((goal) => [goal.id, goal]))
  // The real projection each goal is compared against: its baseline row (falling
  // back to the sandbox row for a goal created in the sandbox) at the real
  // funding rate.
  const baselineFor = (goal: Goal) => {
    const realGoal = baselineGoalById.get(goal.id) ?? goal
    const realContributionCents = contributionForGoal(goal.id, baselineLines)
    return {
      contributionCents: realContributionCents,
      projection: goalProjection(realGoal, linkedSaver(realGoal, savers), realContributionCents),
    }
  }

  return (
    <Stack gap="sm">
      <EditableList<Goal, GoalInput>
        items={orderedGoals}
        addLabel="Add goal"
        emptyMessage="No goals yet."
        deleteTarget={(goal) => ({ title: 'Delete goal?', itemLabel: goal.name })}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        renderItem={(goal, { onEdit, onDelete: onDeleteItem }) => {
          const baseline = baselineFor(goal)
          return (
            <GoalItem
              goal={goal}
              saver={linkedSaver(goal, savers)}
              contributionCents={contributionForGoal(goal.id, lines)}
              baselineContributionCents={baseline.contributionCents}
              baselineProjection={baseline.projection}
              onEdit={onEdit}
              onDelete={onDeleteItem}
            />
          )
        }}
        renderForm={({ initial, onSubmit, onCancel }) => (
          <GoalForm initial={initial} savers={savers} onSubmit={onSubmit} onCancel={onCancel} />
        )}
      />
    </Stack>
  )
}
