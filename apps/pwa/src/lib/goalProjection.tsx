/**
 * Presentation helpers for the Goals screen: splitting the household's goals
 * into the funded ("active") list and the queued "Upcoming" list, projecting
 * each, and turning a projection into the progress, status flag, and ETA line a
 * goal row shows.
 */

import type { ReactNode } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import {
  fortnightlyCents,
  projectGoal,
  projectGoalQueue,
  type GoalProjection,
  type QueuedGoalProjection,
  type SavingsGoal,
} from '@nest/plan'
import { ComparedAmount, ComparedDate } from '../components/ComparedAmount'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal } from '../hooks/useGoals'
import type { Saver } from '../hooks/useSavers'
import { formatIsoDate } from './dates'
import { assumedInterestNote } from './goals'
import { formatPerFortnight } from './money'

/** A goal's derived display: its effective balance, progress, status flag, and ETA. */
export interface GoalDisplay {
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

/** The account a goal links to, when set and still visible to the household. */
export function linkedSaver(goal: Goal, savers: Saver[]): Saver | undefined {
  return goal.linked_account_id === null
    ? undefined
    : savers.find((saver) => saver.id === goal.linked_account_id)
}

/** The fortnightly contribution funding a goal: the sum of its linked budget lines. */
export function contributionForGoal(goalId: string, lines: BudgetLine[]): number {
  return lines
    .filter((line) => line.goal_id === goalId)
    .reduce((total, line) => total + fortnightlyCents(line.amount_cents, line.frequency), 0)
}

/** A goal's effective balance: its linked saver's synced balance, else the manual figure. */
export function effectiveBalanceCents(goal: Goal, saver: Saver | undefined): number {
  return saver ? saver.balance_cents : goal.current_balance_cents
}

/** A goal in `@nest/plan`'s shape, its balance taken from the linked saver when there is one. */
export function toSavingsGoal(goal: Goal, saver: Saver | undefined): SavingsGoal {
  return {
    targetAmountCents: goal.target_amount_cents,
    currentBalanceCents: effectiveBalanceCents(goal, saver),
    ...(goal.target_date != null && { targetDate: goal.target_date }),
    annualInterestBps: goal.annual_interest_bps,
  }
}

function pluraliseFortnights(count: number): string {
  return `${count} ${count === 1 ? 'fortnight' : 'fortnights'}`
}

/**
 * The queued-goal id order after a drag drops `draggedId` onto `overId`, or null
 * when the drop is a no-op (same row, or an id that has left the queue).
 */
export function nextQueueOrder(
  ids: readonly string[],
  draggedId: string,
  overId: string,
): string[] | null {
  if (draggedId === overId) {
    return null
  }
  const from = ids.indexOf(draggedId)
  const to = ids.indexOf(overId)
  if (from === -1 || to === -1) {
    return null
  }
  return arrayMove([...ids], from, to)
}

/** Splits the goals into those funded by a linked line (active) and the rest (queued), queued in order. */
export function partitionGoals(
  goals: Goal[],
  lines: BudgetLine[],
): { active: Goal[]; queued: Goal[] } {
  const active = goals.filter((goal) => contributionForGoal(goal.id, lines) > 0)
  const queued = goals
    .filter((goal) => contributionForGoal(goal.id, lines) === 0)
    .sort((a, b) => {
      const positionA = a.queue_position ?? Number.POSITIVE_INFINITY
      const positionB = b.queue_position ?? Number.POSITIVE_INFINITY
      return positionA - positionB || a.name.localeCompare(b.name)
    })
  return { active, queued }
}

/** The queued goals' projections keyed by goal id, from one `projectGoalQueue` pass over the list. */
export function queuedProjectionsById(
  goals: Goal[],
  lines: BudgetLine[],
  savers: Saver[],
  now: Date,
): Map<string, QueuedGoalProjection> {
  const { active, queued } = partitionGoals(goals, lines)
  const projection = projectGoalQueue(
    active.map((goal) => ({
      goal: toSavingsGoal(goal, linkedSaver(goal, savers)),
      fortnightlyContributionCents: contributionForGoal(goal.id, lines),
    })),
    queued.map((goal) => ({
      goal: toSavingsGoal(goal, linkedSaver(goal, savers)),
      plannedContributionCents: goal.planned_contribution_cents,
    })),
    now,
  )
  return new Map(queued.map((goal, index) => [goal.id, projection.queued[index]!]))
}

/** A goal's raw projection from its effective balance and fortnightly contribution. */
export function goalProjection(
  goal: Goal,
  saver: Saver | undefined,
  contributionCents: number,
): GoalProjection {
  return projectGoal(toSavingsGoal(goal, saver), contributionCents, new Date())
}

/** The percent of a goal's target its balance covers, 100 for a zero target. */
function goalPercent(targetAmountCents: number, balanceCents: number): number {
  return targetAmountCents > 0 ? Math.min(100, (balanceCents / targetAmountCents) * 100) : 100
}

/** Appends the assumed-interest note to a display's ETA line, unless the goal is already met. */
function withRateNote(display: GoalDisplay, goal: Goal, alreadyMet: boolean): GoalDisplay {
  const rateNote = alreadyMet ? null : assumedInterestNote(goal.annual_interest_bps)
  if (rateNote === null) {
    return display
  }
  return {
    ...display,
    eta: (
      <>
        {display.eta} · {rateNote}
      </>
    ),
  }
}

/**
 * Derives an active goal's progress, status flag, and ETA from its target and
 * contribution. `baseline`, when given, is the same projection from the real
 * rows: the ETA line then shows what the sandbox edit moved.
 */
export function goalDisplay(
  goal: Goal,
  saver: Saver | undefined,
  contributionCents: number,
  baseline?: GoalProjection,
): GoalDisplay {
  const currentBalanceCents = effectiveBalanceCents(goal, saver)
  const projection = goalProjection(goal, saver, contributionCents)
  const percent = goalPercent(goal.target_amount_cents, currentBalanceCents)

  let status: { label: string; color: string }
  let eta: ReactNode
  if (projection.alreadyMet) {
    status = { label: 'Reached', color: 'positive' }
    eta = 'Goal reached.'
  } else if (goal.target_date !== null) {
    // `toSavingsGoal` gives the goal a `targetDate` here, so `projectGoal`
    // always returns a required contribution — the `?? 0` never fires.
    /* v8 ignore next */
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

  return withRateNote({ currentBalanceCents, percent, status, eta }, goal, projection.alreadyMet)
}

/**
 * Derives a queued goal's progress, status flag, and ETA from its place in the
 * queue. It starts saving once the goals above it are met: the ETA line leads
 * with its projected start, then the projected completion (or, for a dated goal,
 * the contribution it needs from that start). `baseline` shows a sandbox move.
 */
export function queuedGoalDisplay(
  goal: Goal,
  saver: Saver | undefined,
  projection: QueuedGoalProjection,
  baseline?: QueuedGoalProjection,
): GoalDisplay {
  const currentBalanceCents = effectiveBalanceCents(goal, saver)
  const percent = goalPercent(goal.target_amount_cents, currentBalanceCents)

  let status: { label: string; color: string }
  let eta: ReactNode
  if (projection.alreadyMet) {
    status = { label: 'Reached', color: 'positive' }
    eta = 'Goal reached.'
  } else if (projection.projectedStartDate === null) {
    status = { label: 'No ETA', color: 'gray' }
    eta = 'No projected start — fund a goal above.'
  } else {
    const startsLead = `Starts ${formatIsoDate(projection.projectedStartDate)} · `
    if (goal.target_date !== null) {
      const required = projection.requiredFortnightlyContributionCents ?? 0
      const completionIso = projection.projectedCompletionDate
      const onTrack = completionIso !== null && completionIso <= goal.target_date
      status = onTrack
        ? { label: 'On track', color: 'positive' }
        : { label: 'Behind', color: 'warning' }
      const baselineRequired = baseline?.requiredFortnightlyContributionCents ?? required
      const lead = `${startsLead}By ${formatIsoDate(goal.target_date)} needs `
      eta =
        baselineRequired === required ? (
          `${lead}${formatPerFortnight(required)}`
        ) : (
          <>
            {lead}
            <ComparedAmount span baselineCents={baselineRequired} proposedCents={required} />
            {' / fn'}
          </>
        )
    } else {
      status = { label: 'Upcoming', color: 'info' }
      const completionIso = projection.projectedCompletionDate
      const baselineIso = baseline?.projectedCompletionDate ?? completionIso
      const lead =
        projection.fortnightsToTarget !== null
          ? `${startsLead}${pluraliseFortnights(projection.fortnightsToTarget)} — `
          : startsLead
      eta =
        completionIso === null ? (
          `${startsLead}no completion projected`
        ) : baselineIso === completionIso ? (
          `${lead}${formatIsoDate(completionIso)}`
        ) : (
          <>
            {lead}
            <ComparedDate span baselineIso={baselineIso} proposedIso={completionIso} />
          </>
        )
    }
  }

  return withRateNote({ currentBalanceCents, percent, status, eta }, goal, projection.alreadyMet)
}
