import { describe, expect, it } from 'vitest'
import {
  centsToDollars,
  dollarsToCents,
  formatCents,
  formatPerFortnight,
  formatPerYear,
  moneyColor,
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
  it('is green for a positive amount', () => {
    expect(moneyColor(1)).toBe('light-dark(#1f7a3d, var(--mantine-color-green-4))')
  })

  it('is red for a negative amount', () => {
    expect(moneyColor(-1)).toBe(
      'light-dark(var(--mantine-color-red-9), var(--mantine-color-red-4))',
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
