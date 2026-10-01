import { describe, expect, it } from 'vitest'
import {
  centsToMicrodollars,
  divideRoundHalfUp,
  scaleRoundHalfUp,
  unitsValueCents,
} from './unitPrice.ts'

describe('divideRoundHalfUp', () => {
  it('rounds halves toward positive infinity', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n)
    expect(divideRoundHalfUp(4n, 2n)).toBe(2n)
    expect(divideRoundHalfUp(7n, 3n)).toBe(2n)
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-2n)
    expect(divideRoundHalfUp(-7n, 3n)).toBe(-2n)
    expect(divideRoundHalfUp(-1n, 3n)).toBe(0n)
    expect(divideRoundHalfUp(0n, 3n)).toBe(0n)
  })
})

describe('scaleRoundHalfUp', () => {
  it('is exact where a float product would lose digits', () => {
    // 123,456,789,012 × 999,999,999,999 / 1,000,000,000,000 is beyond 2^53 before dividing.
    expect(scaleRoundHalfUp(123_456_789_012, 999_999_999_999, 1_000_000_000_000)).toBe(
      123_456_789_012,
    )
  })
})

describe('unitsValueCents', () => {
  it('multiplies micro-units by a microdollar price to half-up cents', () => {
    expect(unitsValueCents(2_000_000, 33_083_072)).toBe(66_17)
    expect(unitsValueCents(3_000_000, 835_000)).toBe(2_51)
    expect(unitsValueCents(500_000, 100_000_000)).toBe(50_00)
    expect(unitsValueCents(0, 33_083_072)).toBe(0)
  })

  it('holds large positions exactly', () => {
    // 5,000,000 units at $4,000.123457 = $20,000,617,285.00.
    expect(unitsValueCents(5_000_000_000_000, 4_000_123_457)).toBe(2_000_061_728_500)
  })
})

describe('centsToMicrodollars', () => {
  it('scales a cent to 10,000 microdollars', () => {
    expect(centsToMicrodollars(1)).toBe(10_000)
    expect(centsToMicrodollars(98_50)).toBe(98_500_000)
  })
})
