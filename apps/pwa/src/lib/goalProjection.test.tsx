import { describe, expect, it } from 'vitest'
import type { GoalProjection, QueuedGoalProjection } from '@nest/plan'
import { makeGoal } from '../test/fixtures'
import { render } from '../test/render'
import { goalDisplay, partitionGoals, queuedGoalDisplay } from './goalProjection'

describe('partitionGoals', () => {
  it('orders unpositioned queued goals by name', () => {
    const { active, queued } = partitionGoals(
      [
        makeGoal({ id: 'g1', name: 'Boat', queue_position: null }),
        makeGoal({ id: 'g2', name: 'Anchor', queue_position: null }),
      ],
      [],
    )

    expect(active).toEqual([])
    expect(queued.map((goal) => goal.name)).toEqual(['Anchor', 'Boat'])
  })

  it('orders positioned queued goals by their queue position', () => {
    const { queued } = partitionGoals(
      [
        makeGoal({ id: 'g1', name: 'B', queue_position: 1 }),
        makeGoal({ id: 'g2', name: 'A', queue_position: 0 }),
      ],
      [],
    )

    expect(queued.map((goal) => goal.id)).toEqual(['g2', 'g1'])
  })
})

describe('goalDisplay', () => {
  it('marks an already-met active goal as reached', () => {
    const display = goalDisplay(
      makeGoal({ target_amount_cents: 500_000, current_balance_cents: 600_000 }),
      undefined,
      100_00,
    )

    expect(display.status.label).toBe('Reached')
    expect(display.eta).toBe('Goal reached.')
  })

  it('has no ETA for an active goal with nothing funding it', () => {
    const display = goalDisplay(
      makeGoal({ target_amount_cents: 1_000_000, target_date: null }),
      undefined,
      0,
    )

    expect(display.status.label).toBe('No ETA')
    expect(display.eta).toBe('Link a savings item to project an ETA.')
  })

  it('reads the plain completion date for an undated goal with no baseline', () => {
    const display = goalDisplay(
      makeGoal({ target_amount_cents: 500_000, target_date: null }),
      undefined,
      500_00,
    )

    expect(display.status.label).toBe('On track')
    expect(display.eta).toMatch(/^10 fortnights — /)
  })

  it('reads the plain required contribution for a dated goal with no baseline', () => {
    const display = goalDisplay(
      makeGoal({ target_amount_cents: 1_000_000, target_date: '2030-01-01' }),
      undefined,
      100_00,
    )

    expect(display.eta).toMatch(/By 1 Jan 2030 needs /)
    expect(typeof display.eta).toBe('string')
  })

  it('shows a required-contribution move for a dated goal whose baseline differs', () => {
    const baseline: GoalProjection = {
      remainingCents: 1_000_000,
      alreadyMet: false,
      fortnightsToTarget: 10,
      projectedCompletionDate: '2030-01-01',
      requiredFortnightlyContributionCents: 5_00,
    }
    const display = goalDisplay(
      makeGoal({ target_amount_cents: 1_000_000, target_date: '2030-01-01' }),
      undefined,
      100_00,
      baseline,
    )

    expect(typeof display.eta).not.toBe('string')
    const { getByText } = render(<>{display.eta}</>)
    expect(getByText(/needs/)).toBeInTheDocument()
  })
})

describe('queuedGoalDisplay', () => {
  const queued = (overrides: Partial<QueuedGoalProjection>): QueuedGoalProjection => ({
    remainingCents: 1_000_000,
    alreadyMet: false,
    fortnightsToTarget: null,
    projectedCompletionDate: null,
    requiredFortnightlyContributionCents: null,
    projectedStartDate: '2027-01-01',
    ...overrides,
  })

  it('falls back to a zero required contribution when the queue projects none', () => {
    const display = queuedGoalDisplay(
      makeGoal({ target_amount_cents: 1_000_000, target_date: '2030-01-01' }),
      undefined,
      queued({ requiredFortnightlyContributionCents: null, projectedCompletionDate: null }),
    )

    expect(display.status.label).toBe('Behind')
    expect(display.eta).toBe('Starts 1 Jan 2027 · By 1 Jan 2030 needs $0.00 / fn')
  })

  it('says an undated queued goal has no completion when the queue never fills it', () => {
    const display = queuedGoalDisplay(
      makeGoal({ target_amount_cents: 1_000_000, target_date: null }),
      undefined,
      queued({ fortnightsToTarget: null, projectedCompletionDate: null }),
    )

    expect(display.status.label).toBe('Upcoming')
    expect(display.eta).toBe('Starts 1 Jan 2027 · no completion projected')
  })

  it('shows a completion-date move for an undated queued goal whose baseline differs', () => {
    const projection = queued({ fortnightsToTarget: 10, projectedCompletionDate: '2028-06-01' })
    const display = queuedGoalDisplay(
      makeGoal({ target_amount_cents: 1_000_000, target_date: null }),
      undefined,
      projection,
      { ...projection, projectedCompletionDate: '2029-06-01' },
    )

    expect(typeof display.eta).not.toBe('string')
    const { getByText } = render(<>{display.eta}</>)
    expect(getByText(/Starts 1 Jan 2027/)).toBeInTheDocument()
  })
})
