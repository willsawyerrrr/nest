import { describe, expect, it } from 'vitest'
import { centsToDollars, dollarsToCents, formatCents, moneyColor } from './money'

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
})

describe('moneyColor', () => {
  it('returns a green pair for a positive amount', () => {
    expect(moneyColor(1_00)).toBe(
      'light-dark(var(--mantine-color-green-8), var(--mantine-color-green-4))',
    )
  })

  it('returns a red pair for a negative amount', () => {
    expect(moneyColor(-1_00)).toBe(
      'light-dark(var(--mantine-color-red-8), var(--mantine-color-red-4))',
    )
  })

  it('returns undefined at zero so the figure keeps the default text colour', () => {
    expect(moneyColor(0)).toBeUndefined()
  })
})
