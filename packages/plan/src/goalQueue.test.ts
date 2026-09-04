import { describe, expect, it } from 'vitest'
import { queuedGoalCashByFortnight } from './goalQueue.ts'
import { projectGoalQueue } from './index.ts'

const NOW = new Date('2026-07-19T00:00:00Z')
const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000

/** The ISO date `fortnights` whole fortnights after `NOW`. */
function afterFortnights(fortnights: number): string {
  return new Date(NOW.getTime() + fortnights * FORTNIGHT_MS).toISOString().slice(0, 10)
}

describe('projectGoalQueue', () => {
  it('starts a queued goal when the active goal frees its contribution', () => {
    // Active: $8,000 remaining at $500/fn → 16 fortnights.
    const { active, queued } = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 10_000_00, currentBalanceCents: 2_000_00 },
          fortnightlyContributionCents: 500_00,
        },
      ],
      [{ goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 } }],
      NOW,
    )

    expect(active[0]!.fortnightsToTarget).toBe(16)
    expect(queued[0]!.projectedStartDate).toBe(active[0]!.projectedCompletionDate)
    expect(queued[0]!.projectedStartDate).toBe(afterFortnights(16))
    // Drawing the freed $500/fn from fortnight 16, $5,000 lands ten draws later.
    expect(queued[0]!.fortnightsToTarget).toBe(25)
    expect(queued[0]!.projectedCompletionDate).toBe(afterFortnights(25))
    expect(queued[0]!.remainingCents).toBe(5_000_00)
  })

  it('steps the freed pool up as each active goal completes', () => {
    const activeGoals = [
      {
        goal: { targetAmountCents: 8_000_00, currentBalanceCents: 0 },
        fortnightlyContributionCents: 500_00,
      },
      {
        goal: { targetAmountCents: 20_000_00, currentBalanceCents: 0 },
        fortnightlyContributionCents: 1_000_00,
      },
    ]
    const stepped = projectGoalQueue(
      activeGoals,
      [{ goal: { targetAmountCents: 30_000_00, currentBalanceCents: 0 } }],
      NOW,
    )
    // A single active goal already freeing the full $1,500/fn from fortnight 16.
    const full = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 24_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 1_500_00,
        },
      ],
      [{ goal: { targetAmountCents: 30_000_00, currentBalanceCents: 0 } }],
      NOW,
    )

    expect(stepped.active[0]!.fortnightsToTarget).toBe(16)
    // The queue starts at the earlier active completion, not the later one.
    expect(stepped.queued[0]!.projectedStartDate).toBe(afterFortnights(16))
    // The ramped pool reaches the target later than the full pool would.
    expect(stepped.queued[0]!.fortnightsToTarget!).toBeGreaterThan(
      full.queued[0]!.fortnightsToTarget!,
    )
  })

  it('caps a queued goal at its planned contribution and cascades the rest', () => {
    const { queued } = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 1_000_00,
        },
      ],
      [
        {
          goal: { targetAmountCents: 50_000_00, currentBalanceCents: 0 },
          plannedContributionCents: 300_00,
        },
        { goal: { targetAmountCents: 50_000_00, currentBalanceCents: 0 } },
      ],
      NOW,
    )

    // Both start the fortnight the $1,000/fn pool opens: the first draws its
    // $300 cap, the second draws the $700 remainder.
    expect(queued[0]!.projectedStartDate).toBe(queued[1]!.projectedStartDate)
    expect(queued[0]!.projectedStartDate).not.toBeNull()
  })

  it('ignores a planned contribution above the available pool', () => {
    const capped = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 500_00,
        },
      ],
      [
        {
          goal: { targetAmountCents: 20_000_00, currentBalanceCents: 0 },
          plannedContributionCents: 900_00,
        },
      ],
      NOW,
    )
    const uncapped = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 500_00,
        },
      ],
      [{ goal: { targetAmountCents: 20_000_00, currentBalanceCents: 0 } }],
      NOW,
    )

    expect(capped.queued[0]!.fortnightsToTarget).toBe(uncapped.queued[0]!.fortnightsToTarget)
    expect(capped.queued[0]!.projectedCompletionDate).toBe(
      uncapped.queued[0]!.projectedCompletionDate,
    )
  })

  it('leaves every queued goal unprojected when no active goal funds the pool', () => {
    const { queued } = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 10_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 0,
        },
      ],
      [
        { goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0, targetDate: '2030-01-01' } },
        { goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 } },
      ],
      NOW,
    )

    for (const projection of queued) {
      expect(projection.projectedStartDate).toBeNull()
      expect(projection.projectedCompletionDate).toBeNull()
      expect(projection.fortnightsToTarget).toBeNull()
      expect(projection.requiredFortnightlyContributionCents).toBeNull()
    }
  })

  it('excludes an active goal whose ETA is unreachable from the pool', () => {
    const { queued } = projectGoalQueue(
      [
        {
          // $1M at $100/fn → 10,000 fortnights, past the ~200-year walk.
          goal: { targetAmountCents: 1_000_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 100_00,
        },
        {
          goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 500_00,
        },
      ],
      [{ goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 } }],
      NOW,
    )

    // Only the reachable active goal (10 fortnights) feeds the queue.
    expect(queued[0]!.projectedStartDate).toBe(afterFortnights(10))
    expect(queued[0]!.fortnightsToTarget).not.toBeNull()
  })

  it('treats a queued goal already at its target as complete now', () => {
    const { queued } = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 500_00,
        },
      ],
      [
        { goal: { targetAmountCents: 1_000_00, currentBalanceCents: 2_000_00 } },
        { goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 } },
      ],
      NOW,
    )

    expect(queued[0]!.alreadyMet).toBe(true)
    expect(queued[0]!.fortnightsToTarget).toBe(0)
    expect(queued[0]!.projectedCompletionDate).toBe(afterFortnights(0))
    // The met goal does not delay the one behind it.
    expect(queued[1]!.projectedStartDate).toBe(afterFortnights(10))
  })

  it('reaches a queued goal sooner when it models interest', () => {
    const active = [
      {
        goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
        fortnightlyContributionCents: 500_00,
      },
    ]
    const withInterest = projectGoalQueue(
      active,
      [{ goal: { targetAmountCents: 20_000_00, currentBalanceCents: 0, annualInterestBps: 2000 } }],
      NOW,
    )
    const withoutInterest = projectGoalQueue(
      active,
      [{ goal: { targetAmountCents: 20_000_00, currentBalanceCents: 0, annualInterestBps: 0 } }],
      NOW,
    )
    const absent = projectGoalQueue(
      active,
      [{ goal: { targetAmountCents: 20_000_00, currentBalanceCents: 0 } }],
      NOW,
    )

    expect(withInterest.queued[0]!.fortnightsToTarget!).toBeLessThan(
      withoutInterest.queued[0]!.fortnightsToTarget!,
    )
    expect(absent.queued[0]!.fortnightsToTarget).toBe(withoutInterest.queued[0]!.fortnightsToTarget)
  })

  it('measures a dated queued goal from its projected start, not from now', () => {
    const { queued } = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 500_00,
        },
      ],
      [
        {
          goal: {
            targetAmountCents: 10_000_00,
            currentBalanceCents: 0,
            targetDate: afterFortnights(30),
          },
        },
      ],
      NOW,
    )

    // Start at fortnight 10; 20 fortnights to the date → ceil($10,000 / 20).
    expect(queued[0]!.projectedStartDate).toBe(afterFortnights(10))
    expect(queued[0]!.requiredFortnightlyContributionCents).toBe(500_00)
  })

  it('asks for the full remaining amount when a queued goal starts after its target date', () => {
    const { queued } = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 500_00,
        },
      ],
      [
        {
          goal: {
            targetAmountCents: 10_000_00,
            currentBalanceCents: 2_000_00,
            targetDate: afterFortnights(5),
          },
        },
      ],
      NOW,
    )

    expect(queued[0]!.requiredFortnightlyContributionCents).toBe(8_000_00)
  })

  it('cascades a mid-fortnight overshoot to the next goal in the same fortnight', () => {
    // The active goal frees $1,000/fn at fortnight 5. The first queued goal needs
    // only $200 more, so the remaining $800 must reach the second goal the same
    // fortnight the pool opens.
    const { queued } = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 1_000_00,
        },
      ],
      [
        { goal: { targetAmountCents: 5_000_00, currentBalanceCents: 4_800_00 } },
        { goal: { targetAmountCents: 20_000_00, currentBalanceCents: 0 } },
      ],
      NOW,
    )

    expect(queued[0]!.fortnightsToTarget).toBe(5)
    expect(queued[0]!.projectedStartDate).toBe(afterFortnights(5))
    expect(queued[1]!.projectedStartDate).toBe(afterFortnights(5))
  })

  it('yields null dates for a queue that cannot finish within the ~200-year cap', () => {
    const { queued } = projectGoalQueue(
      [
        {
          goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
          fortnightlyContributionCents: 1,
        },
      ],
      [{ goal: { targetAmountCents: 1_000_000_00, currentBalanceCents: 0 } }],
      NOW,
    )

    expect(queued[0]!.fortnightsToTarget).toBeNull()
    expect(queued[0]!.projectedCompletionDate).toBeNull()
  })
})

describe('queuedGoalCashByFortnight', () => {
  it('is zero before the pool opens and ramps once it does', () => {
    const active = [
      {
        goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
        fortnightlyContributionCents: 500_00,
      },
    ]
    const queued = [{ goal: { targetAmountCents: 100_000_00, currentBalanceCents: 0 } }]
    // Pool opens at fortnight 10 ($5,000 / $500).
    const [before, atOpen, later] = queuedGoalCashByFortnight(active, queued, NOW, [9, 10, 20])

    expect(before).toBe(0)
    expect(atOpen).toBe(500_00)
    expect(later).toBe(5_500_00)
  })

  it('caps a goal cash figure at its remaining-to-target', () => {
    const active = [
      {
        goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
        fortnightlyContributionCents: 500_00,
      },
    ]
    const queued = [{ goal: { targetAmountCents: 1_000_00, currentBalanceCents: 0 } }]
    const [mid, end] = queuedGoalCashByFortnight(active, queued, NOW, [12, 200])

    expect(mid).toBe(1_000_00)
    expect(end).toBe(1_000_00)
  })

  it('returns zeros when there are no queued goals', () => {
    expect(
      queuedGoalCashByFortnight(
        [
          {
            goal: { targetAmountCents: 5_000_00, currentBalanceCents: 0 },
            fortnightlyContributionCents: 500_00,
          },
        ],
        [],
        NOW,
        [10, 20],
      ),
    ).toEqual([0, 0])
  })
})
