import { describe, expect, it } from 'vitest'
import { projectGoal } from './index'

const NOW = new Date('2026-07-19T00:00:00Z')

describe('projectGoal', () => {
  it('projects an on-track goal to a fortnight count and completion date', () => {
    // Remaining $8,000 at $500/fn → 16 fortnights → 224 days from 2026-07-19.
    const projection = projectGoal(
      { targetAmountCents: 10_000_00, currentBalanceCents: 2_000_00 },
      500_00,
      NOW,
    )
    expect(projection.remainingCents).toBe(8_000_00)
    expect(projection.alreadyMet).toBe(false)
    expect(projection.fortnightsToTarget).toBe(16)
    expect(projection.projectedCompletionDate).toBe('2027-02-28')
    expect(projection.requiredFortnightlyContributionCents).toBeNull()
  })

  it('rounds a partial final fortnight up', () => {
    // Remaining $850 at $500/fn → 1.7 → 2 fortnights.
    const projection = projectGoal(
      { targetAmountCents: 850_00, currentBalanceCents: 0 },
      500_00,
      NOW,
    )
    expect(projection.fortnightsToTarget).toBe(2)
  })

  it('treats an already-met goal as complete now', () => {
    const projection = projectGoal(
      { targetAmountCents: 5_000_00, currentBalanceCents: 6_000_00, targetDate: '2027-01-01' },
      500_00,
      NOW,
    )
    expect(projection.remainingCents).toBe(0)
    expect(projection.alreadyMet).toBe(true)
    expect(projection.fortnightsToTarget).toBe(0)
    expect(projection.projectedCompletionDate).toBe('2026-07-19')
    expect(projection.requiredFortnightlyContributionCents).toBe(0)
  })

  it('never completes with a zero contribution', () => {
    const projection = projectGoal({ targetAmountCents: 10_000_00, currentBalanceCents: 0 }, 0, NOW)
    expect(projection.remainingCents).toBe(10_000_00)
    expect(projection.alreadyMet).toBe(false)
    expect(projection.fortnightsToTarget).toBeNull()
    expect(projection.projectedCompletionDate).toBeNull()
  })

  it('derives the fortnightly contribution required to hit a target date', () => {
    // Remaining $10,000 with ~1 year left → ceil(365/14) = 27 fortnights → ceil(1_000_000/27).
    const projection = projectGoal(
      { targetAmountCents: 10_000_00, currentBalanceCents: 0, targetDate: '2027-07-19' },
      500_00,
      NOW,
    )
    expect(projection.requiredFortnightlyContributionCents).toBe(370_38)
  })

  it('requires the full remaining amount when the target date is already past', () => {
    const projection = projectGoal(
      { targetAmountCents: 10_000_00, currentBalanceCents: 2_000_00, targetDate: '2026-06-30' },
      500_00,
      NOW,
    )
    expect(projection.requiredFortnightlyContributionCents).toBe(8_000_00)
  })
})
