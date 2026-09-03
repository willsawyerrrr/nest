import { describe, expect, it } from 'vitest'
import {
  equityTotalCents,
  exerciseCostCents,
  grantValueCents,
  grossVestedValueCents,
  vestedQuantity,
  type EquityGrant,
} from './equity.ts'

/** A 48-unit grant on a 12-month cliff / 48-month / monthly schedule from 2024-01-15. */
function grant(overrides: Partial<EquityGrant> = {}): EquityGrant {
  return {
    quantity: 48,
    grantDate: '2024-01-15',
    cliffMonths: 12,
    vestingPeriodMonths: 48,
    vestingFrequency: 'monthly',
    instrumentType: 'share',
    strikePriceCents: null,
    pricePerShareCents: 1_00,
    ...overrides,
  }
}

describe('vestedQuantity', () => {
  it('vests nothing before the cliff', () => {
    expect(vestedQuantity(grant(), new Date('2024-12-15'))).toBe(0)
    expect(vestedQuantity(grant(), new Date('2025-01-14'))).toBe(0)
  })

  it('vests the accrued tranches at the cliff boundary', () => {
    // At month 12, 12/48 of 48 units → 12.
    expect(vestedQuantity(grant(), new Date('2025-01-15'))).toBe(12)
  })

  it('vests fully once the vesting period has elapsed', () => {
    expect(vestedQuantity(grant(), new Date('2028-01-15'))).toBe(48)
  })

  it('stays fully vested past the vesting period', () => {
    expect(vestedQuantity(grant(), new Date('2030-06-01'))).toBe(48)
  })

  it('rounds the vested quantity down', () => {
    // 100 units, month 13 → 13/48 = 27.08… → 27.
    expect(vestedQuantity(grant({ quantity: 100 }), new Date('2025-02-15'))).toBe(27)
  })

  it('vests on interval boundaries for a quarterly schedule', () => {
    const q = grant({ vestingFrequency: 'quarterly' })
    // Month 14 rounds down to the 12-month tranche boundary → 12/48.
    expect(vestedQuantity(q, new Date('2025-03-15'))).toBe(12)
    // Month 15 reaches the next quarterly boundary → 15/48 of 48 → 15.
    expect(vestedQuantity(q, new Date('2025-04-15'))).toBe(15)
  })

  it('vests nothing when the as-of date precedes the grant', () => {
    expect(vestedQuantity(grant(), new Date('2023-01-15'))).toBe(0)
  })
})

describe('grantValueCents', () => {
  it('values vested shares at the price per share', () => {
    // 12 vested units × $1.00 = $12.00.
    expect(grantValueCents(grant({ pricePerShareCents: 1_00 }), new Date('2025-01-15'))).toBe(12_00)
  })

  it('values vested options at their intrinsic gain over the strike', () => {
    const options = grant({
      instrumentType: 'option',
      strikePriceCents: 40,
      pricePerShareCents: 1_00,
    })
    // 12 vested × ($1.00 − $0.40) = 12 × 60c = $7.20.
    expect(grantValueCents(options, new Date('2025-01-15'))).toBe(7_20)
  })

  it('is never negative for underwater options', () => {
    const underwater = grant({
      instrumentType: 'option',
      strikePriceCents: 5_00,
      pricePerShareCents: 1_00,
    })
    expect(grantValueCents(underwater, new Date('2028-01-15'))).toBe(0)
  })

  it('treats a null option strike as zero', () => {
    const options = grant({ instrumentType: 'option', strikePriceCents: null })
    expect(grantValueCents(options, new Date('2028-01-15'))).toBe(48_00)
  })

  it('is zero before anything vests', () => {
    expect(grantValueCents(grant(), new Date('2024-06-15'))).toBe(0)
  })
})

describe('gross, exercise cost, and net decomposition', () => {
  it('decomposes an option grant into gross, exercise cost, and net', () => {
    const options = grant({
      instrumentType: 'option',
      strikePriceCents: 40,
      pricePerShareCents: 1_00,
    })
    const asOf = new Date('2025-01-15')
    // 12 vested units.
    const gross = grossVestedValueCents(options, asOf)
    const exerciseCost = exerciseCostCents(options, asOf)
    const net = grantValueCents(options, asOf)
    expect(gross).toBe(12 * 1_00) // vested × price = $12.00
    expect(exerciseCost).toBe(12 * 40) // vested × strike = $4.80
    expect(net).toBe(gross - exerciseCost) // $7.20
  })

  it('leaves a share grant with gross == net and no exercise cost', () => {
    const shares = grant({ pricePerShareCents: 1_00 })
    const asOf = new Date('2025-01-15')
    expect(exerciseCostCents(shares, asOf)).toBe(0)
    expect(grossVestedValueCents(shares, asOf)).toBe(grantValueCents(shares, asOf))
  })

  it('floors an underwater option net at zero while gross stays positive', () => {
    const underwater = grant({
      instrumentType: 'option',
      strikePriceCents: 5_00,
      pricePerShareCents: 1_00,
    })
    const asOf = new Date('2028-01-15') // fully vested: 48 units.
    expect(grossVestedValueCents(underwater, asOf)).toBe(48 * 1_00) // $48.00
    expect(exerciseCostCents(underwater, asOf)).toBe(48 * 5_00) // $240.00
    expect(grantValueCents(underwater, asOf)).toBe(0)
  })
})

describe('equityTotalCents', () => {
  it('sums the vested value of every grant', () => {
    const asOf = new Date('2028-01-15')
    const grants = [
      grant({ pricePerShareCents: 2_00 }), // 48 × $2.00 = $96.00
      grant({
        instrumentType: 'option',
        strikePriceCents: 50,
        pricePerShareCents: 1_00,
        quantity: 100,
      }), // 100 × 50c = $50.00
    ]
    expect(equityTotalCents(grants, asOf)).toBe(96_00 + 50_00)
  })

  it('is zero for no grants', () => {
    expect(equityTotalCents([], new Date('2028-01-15'))).toBe(0)
  })
})
