import { describe, expect, it } from 'vitest'
import {
  centsToDollars,
  dollarsToCents,
  formatCents,
  formatCompactDollars,
  formatPerFortnight,
  formatPerYear,
  moneyColor,
  workUseAmountCents,
} from './money'

describe('formatPerFortnight', () => {
  it('suffixes the currency with a fortnightly rate', () => {
    expect(formatPerFortnight(1_234_56)).toBe('$1,234.56 / fn')
  })
})

describe('formatPerYear', () => {
  it('suffixes the currency with an annual rate', () => {
    expect(formatPerYear(1_234_56)).toBe('$1,234.56 / year')
  })
})

describe('moneyColor', () => {
  it('is the positive token for a positive amount', () => {
    expect(moneyColor(1)).toBe(
      'light-dark(var(--mantine-color-positive-7), var(--mantine-color-positive-4))',
    )
  })

  it('is the negative token for a negative amount', () => {
    expect(moneyColor(-1)).toBe(
      'light-dark(var(--mantine-color-negative-7), var(--mantine-color-negative-4))',
    )
  })

  it('is undefined for zero', () => {
    expect(moneyColor(0)).toBeUndefined()
  })
})

describe('formatCents', () => {
  it('always shows two decimals when the cents are a multiple of ten', () => {
    expect(formatCents(2_067_50)).toBe('$2,067.50')
  })

  it('pads whole-dollar amounts to two decimals', () => {
    expect(formatCents(2_000_00)).toBe('$2,000.00')
  })

  it('formats non-round cents', () => {
    expect(formatCents(1_234_56)).toBe('$1,234.56')
  })

  it('rounds sub-cent fractions to two decimals', () => {
    expect(formatCents(3_846_154 / 10)).toBe('$3,846.15')
  })

  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00')
  })
})

describe('formatCompactDollars', () => {
  it('formats zero as a bare dollar sign', () => {
    expect(formatCompactDollars(0)).toBe('$0')
  })

  it('rounds a sub-1k amount to whole dollars', () => {
    expect(formatCompactDollars(500_00)).toBe('$500')
    expect(formatCompactDollars(499_49)).toBe('$499')
  })

  it('abbreviates thousands with k', () => {
    expect(formatCompactDollars(50_000_00)).toBe('$50k')
    expect(formatCompactDollars(150_000_00)).toBe('$150k')
  })

  it('keeps exact thousands without a decimal', () => {
    expect(formatCompactDollars(1_000_00)).toBe('$1k')
  })

  it('abbreviates millions with M', () => {
    expect(formatCompactDollars(1_200_000_00)).toBe('$1.2M')
    expect(formatCompactDollars(5_000_000_00)).toBe('$5M')
  })

  it('rounds to at most one decimal', () => {
    // $123,450 → 123.45k rounds to 123.5k; $1,234,500 → 1.2345M rounds to 1.2M.
    expect(formatCompactDollars(123_450_00)).toBe('$123.5k')
    expect(formatCompactDollars(1_234_500_00)).toBe('$1.2M')
  })

  it('trims a trailing .0', () => {
    // $150,000 → 150.0k trims to 150k; $2,000,000 → 2.0M trims to 2M.
    expect(formatCompactDollars(150_000_00)).toBe('$150k')
    expect(formatCompactDollars(2_000_000_00)).toBe('$2M')
  })

  it('formats negatives with a leading minus', () => {
    expect(formatCompactDollars(-50_000_00)).toBe('-$50k')
    expect(formatCompactDollars(-1_200_000_00)).toBe('-$1.2M')
    expect(formatCompactDollars(-500_00)).toBe('-$500')
  })
})

describe('centsToDollars', () => {
  it('returns empty string when unset', () => {
    expect(centsToDollars(null)).toBe('')
    expect(centsToDollars(undefined)).toBe('')
  })

  it('converts cents to a dollars number', () => {
    expect(centsToDollars(2_067_50)).toBe(2067.5)
  })
})

describe('dollarsToCents', () => {
  it('returns null when blank', () => {
    expect(dollarsToCents('')).toBeNull()
  })

  it('rounds dollars to integer cents', () => {
    expect(dollarsToCents(2067.5)).toBe(2_067_50)
    expect(dollarsToCents('1234.56')).toBe(1_234_56)
  })

  it('returns null for an unparseable string', () => {
    expect(dollarsToCents('abc')).toBeNull()
  })
})

describe('workUseAmountCents', () => {
  it('claims the whole cost at 100%', () => {
    expect(workUseAmountCents(64_99, 100)).toBe(64_99)
  })

  it('apportions a part-private expense', () => {
    expect(workUseAmountCents(100_00, 60)).toBe(60_00)
    expect(workUseAmountCents(64_99, 60)).toBe(38_99)
  })

  it('rounds a half-cent up, as the database constraint does', () => {
    // 101c at 50% is exactly 50.5c.
    expect(workUseAmountCents(101, 50)).toBe(51)
  })

  it('honours a fractional percentage', () => {
    expect(workUseAmountCents(1_000_00, 33.33)).toBe(333_30)
    expect(workUseAmountCents(1_000_00, 12.5)).toBe(125_00)
  })

  it('claims nothing of nothing', () => {
    expect(workUseAmountCents(0, 60)).toBe(0)
  })
})
