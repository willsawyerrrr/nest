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

  describe('modelled interest', () => {
    it('reduces exactly to the linear projection when the rate is null or zero', () => {
      const base = {
        targetAmountCents: 10_000_00,
        currentBalanceCents: 2_000_00,
        targetDate: '2027-07-19',
      }
      const linear = projectGoal(base, 500_00, NOW)

      expect(projectGoal({ ...base, annualInterestBps: null }, 500_00, NOW)).toEqual(linear)
      expect(projectGoal({ ...base, annualInterestBps: 0 }, 500_00, NOW)).toEqual(linear)
      expect(linear).toEqual({
        remainingCents: 8_000_00,
        alreadyMet: false,
        fortnightsToTarget: 16,
        projectedCompletionDate: '2027-02-28',
        requiredFortnightlyContributionCents: 296_30,
      })
    })

    it('keeps the linear closed form for an undated goal at a zero rate', () => {
      const projection = projectGoal(
        { targetAmountCents: 850_00, currentBalanceCents: 0, annualInterestBps: 0 },
        500_00,
        NOW,
      )
      expect(projection.fortnightsToTarget).toBe(2)
    })

    it('shortens the fortnight count and completion date when a positive rate is modelled', () => {
      const goal = { targetAmountCents: 10_000_00, currentBalanceCents: 2_000_00 }
      const linear = projectGoal(goal, 500_00, NOW)
      const withInterest = projectGoal({ ...goal, annualInterestBps: 2000 }, 500_00, NOW)

      expect(linear.fortnightsToTarget).toBe(16)
      expect(withInterest.fortnightsToTarget).toBe(15)
      expect(withInterest.projectedCompletionDate).toBe('2027-02-14')
    })

    it('reaches the target through growth alone when the contribution is zero', () => {
      // $9,000 → $10,000 with no contribution, at 50% p.a. compounded fortnightly.
      const projection = projectGoal(
        { targetAmountCents: 10_000_00, currentBalanceCents: 9_000_00, annualInterestBps: 5000 },
        0,
        NOW,
      )
      expect(projection.fortnightsToTarget).toBe(7)
      expect(projection.projectedCompletionDate).not.toBeNull()
    })

    it('stays null past the ~200-year fortnight cap', () => {
      const projection = projectGoal(
        { targetAmountCents: 1_000_000_00, currentBalanceCents: 0, annualInterestBps: 1 },
        1,
        NOW,
      )
      expect(projection.fortnightsToTarget).toBeNull()
      expect(projection.projectedCompletionDate).toBeNull()
    })

    it('derives the required contribution from the compound-interest annuity', () => {
      // target $10,000, nothing saved, 5.00% p.a., ~1 year to the date.
      // fortnights left n = ceil(365 / 14) = 27; f = 1.05^(1/26).
      // contribution = target·(f − 1)/(fⁿ − 1), rounded up → $361.41,
      // below the $370.38 the pure linear split would need.
      const withInterest = projectGoal(
        {
          targetAmountCents: 10_000_00,
          currentBalanceCents: 0,
          targetDate: '2027-07-19',
          annualInterestBps: 500,
        },
        0,
        NOW,
      )
      const linear = projectGoal(
        { targetAmountCents: 10_000_00, currentBalanceCents: 0, targetDate: '2027-07-19' },
        0,
        NOW,
      )

      expect(withInterest.requiredFortnightlyContributionCents).toBe(361_41)
      expect(linear.requiredFortnightlyContributionCents).toBe(370_38)
    })

    it('never asks for a negative contribution when growth alone overshoots the target', () => {
      const projection = projectGoal(
        {
          targetAmountCents: 10_000_00,
          currentBalanceCents: 9_900_00,
          targetDate: '2030-01-01',
          annualInterestBps: 1000,
        },
        0,
        NOW,
      )
      expect(projection.requiredFortnightlyContributionCents).toBe(0)
    })
  })
})
