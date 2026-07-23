import { describe, expect, it } from 'vitest'
import type { HelpPayoffProjection } from '@nest/tax'
import {
  combinedHelpCentsByYear,
  DEFAULT_PROJECTION_HORIZON_YEARS,
  projectionHorizonYears,
} from './netWorth'

/** A payoff projection whose only meaningful field here is the closing-balance schedule. */
function payoff(closingBalancesCents: number[]): HelpPayoffProjection {
  return {
    paidOffFinancialYear: null,
    yearsToPayOff: null,
    schedule: closingBalancesCents.map((closingBalanceCents, index) => ({
      financialYear: 2027 + index,
      openingBalanceCents: 0,
      indexationCents: 0,
      repaymentCents: 0,
      closingBalanceCents,
    })),
  }
}

describe('projectionHorizonYears', () => {
  it('takes the longest span to retirement across known ages', () => {
    expect(projectionHorizonYears([40, 30], 60)).toBe(30)
  })

  it('falls back to the default when no age is known', () => {
    expect(projectionHorizonYears([], 60)).toBe(DEFAULT_PROJECTION_HORIZON_YEARS)
  })

  it('falls back to the default when every known member is past retirement', () => {
    expect(projectionHorizonYears([62, 65], 60)).toBe(DEFAULT_PROJECTION_HORIZON_YEARS)
  })
})

describe('combinedHelpCentsByYear', () => {
  it('sums each member closing balance per year, starting from the current total', () => {
    const result = combinedHelpCentsByYear(
      [payoff([20_000_00, 10_000_00, 0]), payoff([5_000_00, 0])],
      35_000_00,
      3,
    )
    // Year 0 = current total; later years sum the members' closing balances, with a
    // cleared/ended schedule contributing zero.
    expect(result).toEqual([35_000_00, 25_000_00, 10_000_00, 0])
  })

  it('returns a flat current total when there are no debts', () => {
    expect(combinedHelpCentsByYear([], 0, 2)).toEqual([0, 0, 0])
  })
})
