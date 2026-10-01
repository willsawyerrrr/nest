import { describe, expect, it } from 'vitest'
import {
  estimateHouseholdTax,
  FY2027_CONFIG,
  householdYearSummary,
  mlsTest,
  type MlsMemberInput,
  type TaxProfileInput,
} from './index.ts'

const config = FY2027_CONFIG

function member(overrides: Partial<MlsMemberInput> & { memberId: string }): MlsMemberInput {
  return {
    taxableIncomeCents: 0,
    reportableSuperCents: 0,
    hasPrivateHospitalCover: false,
    ...overrides,
  }
}

describe('mlsTest', () => {
  it('is below the first family threshold at tier 0', () => {
    const result = mlsTest(
      [member({ memberId: 'a', taxableIncomeCents: 100_000_00 }), member({ memberId: 'b' })],
      0,
      config,
    )
    expect(result).toMatchObject({
      familyIncomeCents: 100_000_00,
      tier: 0,
      rate: 0,
      currentFloorCents: null,
      next: { floorCents: 210_000_00, distanceCents: 110_000_00 },
      liable: false,
      totalSurchargeCents: 0,
    })
  })

  it('treats income exactly at a floor as not over it', () => {
    const result = mlsTest(
      [member({ memberId: 'a', taxableIncomeCents: 210_000_00 }), member({ memberId: 'b' })],
      0,
      config,
    )
    expect(result.tier).toBe(0)
    expect(result.next?.distanceCents).toBe(0)
  })

  it('adds reportable super, fringe benefits and net investment losses to income', () => {
    const result = mlsTest(
      [
        member({
          memberId: 'a',
          taxableIncomeCents: 150_000_00,
          reportableSuperCents: 10_000_00,
          reportableFringeBenefitsCents: 5_000_00,
          netInvestmentLossCents: 2_000_00,
        }),
        member({ memberId: 'b', taxableIncomeCents: 50_000_00 }),
      ],
      0,
      config,
    )
    expect(result.familyIncomeCents).toBe(217_000_00)
    expect(result.members[0]!.incomeForMlsCents).toBe(167_000_00)
    expect(result.tier).toBe(1)
    expect(result.rate).toBe(0.01)
    expect(result.currentFloorCents).toBe(210_000_00)
    expect(result.next).toEqual({ floorCents: 246_000_00, distanceCents: 29_000_00 })
    expect(result.liable).toBe(true)
    expect(result.members[0]!.surchargeCents).toBe(1_670_00)
    expect(result.members[1]!.surchargeCents).toBe(500_00)
    expect(result.totalSurchargeCents).toBe(2_170_00)
  })

  it('is not liable when every member holds cover, though over the threshold', () => {
    const result = mlsTest(
      [
        member({ memberId: 'a', taxableIncomeCents: 150_000_00, hasPrivateHospitalCover: true }),
        member({ memberId: 'b', taxableIncomeCents: 100_000_00, hasPrivateHospitalCover: true }),
      ],
      0,
      config,
    )
    expect(result.tier).toBe(2)
    expect(result.liable).toBe(false)
    expect(result.totalSurchargeCents).toBe(0)
  })

  it('is liable when only one member lacks cover', () => {
    const result = mlsTest(
      [
        member({ memberId: 'a', taxableIncomeCents: 150_000_00, hasPrivateHospitalCover: true }),
        member({ memberId: 'b', taxableIncomeCents: 100_000_00 }),
      ],
      0,
      config,
    )
    expect(result.liable).toBe(true)
    expect(result.totalSurchargeCents).toBe(1_250_00)
  })

  it('has no next threshold at the top tier', () => {
    const result = mlsTest(
      [
        member({ memberId: 'a', taxableIncomeCents: 200_000_00 }),
        member({ memberId: 'b', taxableIncomeCents: 200_000_00 }),
      ],
      0,
      config,
    )
    expect(result.tier).toBe(3)
    expect(result.rate).toBe(0.015)
    expect(result.currentFloorCents).toBe(328_000_00)
    expect(result.next).toBeNull()
  })

  it('raises the family floors by the increment for each child after the first', () => {
    const members = [
      member({ memberId: 'a', taxableIncomeCents: 120_000_00 }),
      member({ memberId: 'b', taxableIncomeCents: 91_000_00 }),
    ]
    expect(mlsTest(members, 1, config).tier).toBe(1)
    const withThree = mlsTest(members, 3, config)
    expect(withThree.tier).toBe(0)
    expect(withThree.next?.floorCents).toBe(213_000_00)
    expect(withThree.dependentChildren).toBe(3)
  })

  it('uses the single floors for a lone member with no children', () => {
    const result = mlsTest([member({ memberId: 'a', taxableIncomeCents: 110_000_00 })], 0, config)
    expect(result.tier).toBe(1)
    expect(result.currentFloorCents).toBe(105_000_00)
    expect(result.next?.floorCents).toBe(123_000_00)
  })
})

describe('householdYearSummary', () => {
  const profiles: TaxProfileInput[] = [
    { memberId: 'a', residency: 'resident', privateHospitalCover: false, helpDebtCents: 0 },
    { memberId: 'b', residency: 'resident', privateHospitalCover: true, helpDebtCents: 0 },
  ]
  const estimate = estimateHouseholdTax(
    [
      { memberId: 'a', type: 'salary', schedule: 'annual', amountCents: 180_000_00 },
      { memberId: 'b', type: 'salary', schedule: 'annual', amountCents: 60_000_00 },
    ],
    profiles,
    config,
    new Map([['a', 10_000_00]]),
    new Map([['b', 2_000_00]]),
    undefined,
    new Map([['b', 20_000_00]]),
  )
  const summary = householdYearSummary(estimate, 0, config)

  it('sums the members into household totals', () => {
    expect(summary.grossIncomeCents).toBe(260_000_00)
    expect(summary.netCapitalGainCents).toBe(20_000_00)
    expect(summary.deductionsCents).toBe(2_000_00)
    expect(summary.concessionalSuperCents).toBe(10_000_00)
    expect(summary.taxableIncomeCents).toBe(170_000_00 + 78_000_00)
    expect(summary.taxCents).toBe(estimate.annualTaxCents)
    expect(summary.afterTaxCents).toBe(estimate.annualAfterTaxCents)
    expect(summary.members.map((m) => m.memberId)).toEqual(['a', 'b'])
    expect(summary.members[0]).toMatchObject({
      grossIncomeCents: 180_000_00,
      taxableIncomeCents: 170_000_00,
      concessionalSuperCents: 10_000_00,
    })
  })

  it('runs the MLS test over taxable income (net capital gain included) plus reportable super, with each member cover', () => {
    expect(summary.mls.familyIncomeCents).toBe(248_000_00 + 10_000_00)
    expect(summary.mls.tier).toBe(2)
    expect(summary.mls.liable).toBe(true)
    expect(summary.mls.members[1]!.surchargeCents).toBe(0)
    expect(summary.mls.totalSurchargeCents).toBe(
      estimate.members[0]!.breakdown.medicareLevySurchargeCents,
    )
  })
})
