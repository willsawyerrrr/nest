import { describe, expect, it } from 'vitest'
import { goalProjectionSeries, projectGoal } from './index'

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

describe('goalProjectionSeries', () => {
  it('climbs from the current balance to the target, one point per fortnight', () => {
    // Remaining $2,000 at $500/fn → 4 fortnights → points at 0..4.
    const series = goalProjectionSeries(
      { targetAmountCents: 10_000_00, currentBalanceCents: 8_000_00 },
      500_00,
      NOW,
    )
    expect(series.map((point) => point.fortnight)).toEqual([0, 1, 2, 3, 4])
    expect(series.map((point) => point.balanceCents)).toEqual([
      8_000_00, 8_500_00, 9_000_00, 9_500_00, 10_000_00,
    ])
    expect(series.at(0)?.date).toBe('2026-07-19')
    expect(series.at(-1)?.date).toBe('2026-09-13')
  })

  it('clamps the final point to the target when the last contribution overshoots', () => {
    // Remaining $850 at $500/fn → 2 fortnights; the raw climb would reach $1,000.
    const series = goalProjectionSeries(
      { targetAmountCents: 850_00, currentBalanceCents: 0 },
      500_00,
      NOW,
    )
    expect(series.at(-1)?.balanceCents).toBe(850_00)
  })

  it('samples at most maxPoints points before the endpoint on a long climb', () => {
    // Remaining $10,000 at $100/fn → 100 fortnights; step ceil(100/24)=5 → 0,5,…,95,100.
    const series = goalProjectionSeries(
      { targetAmountCents: 10_000_00, currentBalanceCents: 0 },
      100_00,
      NOW,
    )
    expect(series.length).toBe(21)
    expect(series.at(0)?.fortnight).toBe(0)
    expect(series.at(1)?.fortnight).toBe(5)
    expect(series.at(-1)?.fortnight).toBe(100)
    expect(series.at(-1)?.balanceCents).toBe(10_000_00)
  })

  it('is empty for an already-met goal', () => {
    expect(
      goalProjectionSeries(
        { targetAmountCents: 5_000_00, currentBalanceCents: 6_000_00 },
        500_00,
        NOW,
      ),
    ).toEqual([])
  })

  it('is empty when a non-positive contribution can never reach the target', () => {
    expect(
      goalProjectionSeries({ targetAmountCents: 10_000_00, currentBalanceCents: 0 }, 0, NOW),
    ).toEqual([])
  })
})
