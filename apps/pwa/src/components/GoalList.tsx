import type { ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge, Group, Progress, Stack, Text, Title } from '@mantine/core'
import { IconGripVertical } from '@tabler/icons-react'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal, GoalInput } from '../hooks/useGoals'
import { useIsWide } from '../hooks/useIsWide'
import type { Saver } from '../hooks/useSavers'
import {
  contributionForGoal,
  goalDisplay,
  goalProjection,
  linkedSaver,
  nextQueueOrder,
  partitionGoals,
  queuedGoalDisplay,
  queuedProjectionsById,
  type GoalDisplay,
} from '../lib/goalProjection'
import { formatCents, formatPerFortnight } from '../lib/money'
import { AppCard } from './AppCard'
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
  /** Persists a new order for the queued goals; drag-reorder is inert without it. */
  onReorderQueue?: (orderedIds: readonly string[]) => Promise<void>
}

interface GoalItemProps {
  goal: Goal
  saver: Saver | undefined
  display: GoalDisplay
  /** The fortnightly contribution shown in the amount column; 0 hides it (a queued goal). */
  contributionCents: number
  /** The real fortnightly contribution, for the planning-mode delta. */
  baselineContributionCents: number
  /** A drag handle rendered beside the row's controls, for a reorderable queued goal. */
  dragHandle?: ReactNode
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
  display,
  contributionCents,
  baselineContributionCents,
  dragHandle,
  onEdit,
  onDelete,
}: GoalItemProps) {
  const { percent, status, eta } = display
  const saverDeleted = Boolean(saver?.deleted_from_source_at)
  const caption = (
    <Text size="xs" c="dimmed" component="div">
      {eta}
      {saver &&
        ` · From synced saver ${saver.name}${saverDeleted ? ' — deleted at source, relink this goal' : ''}`}
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
      <Text size="sm" ta="right" style={{ width: '6rem', flexShrink: 0 }}>
        {formatCents(goal.target_amount_cents)}
      </Text>
      {contributionCents > 0 ? (
        <FortnightlyAmount
          cents={contributionCents}
          baselineCents={baselineContributionCents}
          justify="flex-end"
          style={{ width: '7rem', flexShrink: 0 }}
        />
      ) : (
        <div style={{ width: '7rem', flexShrink: 0 }} />
      )}
      <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
        {dragHandle}
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One goal as a compact bordered card for mobile: progress toward its target and its ETA. */
function GoalCard({
  goal,
  saver,
  display,
  contributionCents,
  dragHandle,
  onEdit,
  onDelete,
}: GoalItemProps) {
  const { currentBalanceCents, percent, status, eta } = display
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
            {dragHandle}
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
              From synced saver {saver.name}
            </Text>
            {saver.deleted_from_source_at && <DeletedInUpBadge />}
          </Group>
        )}
        {saver?.deleted_from_source_at && (
          <Text size="xs" c="dimmed">
            This saver was deleted at its source. Relink the goal to a current saver.
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

/** The grip button that starts a keyboard or pointer drag of a queued goal. */
function DragHandle({
  handleProps,
  label,
}: {
  handleProps: Record<string, unknown>
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: 'none',
        background: 'transparent',
        padding: 2,
        cursor: 'grab',
        color: 'var(--mantine-color-dimmed)',
        touchAction: 'none',
      }}
      {...handleProps}
    >
      <IconGripVertical size={16} />
    </button>
  )
}

/** A queued goal row wrapped in a `@dnd-kit` sortable, with its projected trajectory. */
function SortableGoalItem({
  goal,
  saver,
  display,
  onEdit,
  onDelete,
}: {
  goal: Goal
  saver: Saver | undefined
  display: GoalDisplay
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: goal.id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
      }}
    >
      <GoalItem
        goal={goal}
        saver={saver}
        display={display}
        contributionCents={0}
        baselineContributionCents={0}
        dragHandle={
          <DragHandle
            handleProps={{ ...attributes, ...listeners }}
            label={`Reorder ${goal.name}`}
          />
        }
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  )
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
  onReorderQueue,
}: GoalListProps) {
  const now = new Date()
  const { active, queued } = partitionGoals(goals, lines)
  const queuedProjections = queuedProjectionsById(goals, lines, savers, now)
  const baselineQueuedProjections = queuedProjectionsById(baselineGoals, baselineLines, savers, now)

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

  const queuedIds = queued.map((goal) => goal.id)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over) {
      return
    }
    const reordered = nextQueueOrder(queuedIds, String(event.active.id), String(event.over.id))
    if (reordered) {
      void onReorderQueue?.(reordered)
    }
  }

  return (
    <Stack gap="lg">
      <EditableList<Goal, GoalInput>
        items={active}
        addLabel="Add goal"
        emptyMessage="No goals yet. A new goal waits under Upcoming until a Savings or Investments budget line funds it."
        deleteTarget={(goal) => ({ title: 'Delete goal?', itemLabel: goal.name })}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        renderItem={(goal, { onEdit, onDelete: onDeleteItem }) => {
          const baseline = baselineFor(goal)
          const contributionCents = contributionForGoal(goal.id, lines)
          return (
            <GoalItem
              goal={goal}
              saver={linkedSaver(goal, savers)}
              display={goalDisplay(
                goal,
                linkedSaver(goal, savers),
                contributionCents,
                baseline.projection,
              )}
              contributionCents={contributionCents}
              baselineContributionCents={baseline.contributionCents}
              onEdit={onEdit}
              onDelete={onDeleteItem}
            />
          )
        }}
        renderForm={({ initial, onSubmit, onCancel }) => (
          <GoalForm initial={initial} savers={savers} onSubmit={onSubmit} onCancel={onCancel} />
        )}
      />

      {queued.length > 0 && (
        <Stack gap="xs">
          <Title order={2} size="h5">
            Upcoming
          </Title>
          <Text size="xs" c="dimmed">
            Saved towards once the goals above finish. Drag to reorder. A new goal waits here until
            a Savings or Investments budget line funds it.
          </Text>
          <DndContext
            sensors={sensors}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext items={queuedIds} strategy={verticalListSortingStrategy}>
              <EditableList<Goal, GoalInput>
                items={queued}
                addLabel="Add goal"
                showAdd={false}
                emptyMessage="No upcoming goals."
                deleteTarget={(goal) => ({ title: 'Delete goal?', itemLabel: goal.name })}
                onCreate={onCreate}
                onUpdate={onUpdate}
                onDelete={onDelete}
                renderItem={(goal, { onEdit, onDelete: onDeleteItem }) => (
                  <SortableGoalItem
                    goal={goal}
                    saver={linkedSaver(goal, savers)}
                    display={queuedGoalDisplay(
                      goal,
                      linkedSaver(goal, savers),
                      queuedProjections.get(goal.id)!,
                      baselineQueuedProjections.get(goal.id),
                    )}
                    onEdit={onEdit}
                    onDelete={onDeleteItem}
                  />
                )}
                renderForm={({ initial, onSubmit, onCancel }) => (
                  <GoalForm
                    initial={initial}
                    savers={savers}
                    onSubmit={onSubmit}
                    onCancel={onCancel}
                  />
                )}
              />
            </SortableContext>
          </DndContext>
        </Stack>
      )}
    </Stack>
  )
}
