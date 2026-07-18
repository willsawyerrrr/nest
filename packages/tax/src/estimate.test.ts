import { describe, expect, it } from 'vitest'
import { annualGrossCents, estimateHouseholdTax, FY2027_CONFIG } from './index'
import type { IncomeInput, IncomeSchedule, TaxProfileInput } from './index'

/** Builds a salary income of `amountCents` per period on `schedule`. */
function salary(schedule: IncomeSchedule, amountCents: number): IncomeInput {
  return { memberId: 'm', type: 'salary', schedule, amountCents }
}

describe('annualGrossCents', () => {
  it('annualises salary across every schedule', () => {
    expect(annualGrossCents(salary('weekly', 1_000_00))).toBe(52_000_00)
    expect(annualGrossCents(salary('fortnightly', 1_000_00))).toBe(26_000_00)
    expect(annualGrossCents(salary('monthly', 1_000_00))).toBe(12_000_00)
    expect(annualGrossCents(salary('quarterly', 1_000_00))).toBe(4_000_00)
    expect(annualGrossCents(salary('biannual', 1_000_00))).toBe(2_000_00)
    expect(annualGrossCents(salary('annual', 1_000_00))).toBe(1_000_00)
  })

  it('annualises other income like salary', () => {
    const other: IncomeInput = {
      memberId: 'm',
      type: 'other',
      schedule: 'monthly',
      amountCents: 500_00,
    }
    expect(annualGrossCents(other)).toBe(6_000_00)
  })

  it('annualises a wage from hourly rate and hours per period', () => {
    // $33.15/hr × 38 h/week → $1,259.70/wk × 52 = $65,504.40/yr.
    const wage: IncomeInput = {
      memberId: 'm',
      type: 'wage',
      schedule: 'weekly',
      hourlyRateCents: 33_15,
      hoursPerPeriod: 38,
    }
    expect(annualGrossCents(wage)).toBe(65_504_40)
  })

  it('treats missing amounts as zero', () => {
    expect(annualGrossCents({ memberId: 'm', type: 'salary', schedule: 'annual' })).toBe(0)
    expect(annualGrossCents({ memberId: 'm', type: 'wage', schedule: 'weekly' })).toBe(0)
  })
})

describe('estimateHouseholdTax', () => {
  const incomes: IncomeInput[] = [
    { memberId: 'alex', type: 'salary', schedule: 'annual', amountCents: 130_000_00 },
    {
      memberId: 'sam',
      type: 'wage',
      schedule: 'weekly',
      hourlyRateCents: 33_15,
      hoursPerPeriod: 38,
    },
  ]
  const profiles: TaxProfileInput[] = [
    {
      memberId: 'alex',
      residency: 'resident',
      privateHospitalCover: true,
      helpDebtCents: 30_000_00,
    },
    {
      memberId: 'sam',
      residency: 'resident',
      privateHospitalCover: true,
      helpDebtCents: 20_000_00,
    },
  ]

  it('estimates a two-member household with HELP debt and private cover', () => {
    const household = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG)

    const [alex, sam] = household.members
    expect(alex).toMatchObject({
      memberId: 'alex',
      annualGrossCents: 130_000_00,
      annualTaxCents: 41_196_46,
      annualAfterTaxCents: 88_803_54,
      fortnightlyGrossCents: 5_000_00,
      fortnightlyTaxCents: 1_584_48,
      fortnightlyAfterTaxCents: 3_415_52,
    })
    // Private cover exempts the surcharge; HELP is marginal above $69,528.
    expect(alex!.breakdown.medicareLevySurchargeCents).toBe(0)
    expect(alex!.breakdown.helpRepaymentCents).toBe(9_076_46)

    expect(sam).toMatchObject({
      memberId: 'sam',
      annualGrossCents: 65_504_40,
      annualTaxCents: 11_463_98,
      annualAfterTaxCents: 54_040_42,
      fortnightlyGrossCents: 2_519_40,
      fortnightlyTaxCents: 440_92,
      fortnightlyAfterTaxCents: 2_078_48,
    })
    // Below the $69,528 repayment threshold, so no HELP is due despite the debt.
    expect(sam!.breakdown.helpRepaymentCents).toBe(0)

    expect(household).toMatchObject({
      annualGrossCents: 195_504_40,
      annualTaxCents: 52_660_44,
      annualAfterTaxCents: 142_843_96,
      fortnightlyGrossCents: 7_519_40,
      fortnightlyTaxCents: 2_025_40,
      fortnightlyAfterTaxCents: 5_494_00,
    })
  })

  it('keeps the household consistent with its members', () => {
    const household = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG)
    const sumOf = (pick: (m: (typeof household.members)[number]) => number) =>
      household.members.reduce((total, m) => total + pick(m), 0)

    expect(household.annualGrossCents).toBe(sumOf((m) => m.annualGrossCents))
    expect(household.annualTaxCents).toBe(sumOf((m) => m.annualTaxCents))
    expect(household.annualAfterTaxCents).toBe(sumOf((m) => m.annualAfterTaxCents))
    expect(household.annualGrossCents).toBe(
      household.annualTaxCents + household.annualAfterTaxCents,
    )
    // Fortnightly figures are the annual figures over 26, up to rounding.
    expect(household.fortnightlyGrossCents).toBeCloseTo(household.annualGrossCents / 26, -1)
    expect(household.fortnightlyTaxCents).toBeCloseTo(household.annualTaxCents / 26, -1)
    expect(household.fortnightlyAfterTaxCents).toBeCloseTo(household.annualAfterTaxCents / 26, -1)
  })

  it('sums many incomes for one member across schedules', () => {
    const multi: IncomeInput[] = [
      { memberId: 'alex', type: 'salary', schedule: 'monthly', amountCents: 5_000_00 },
      { memberId: 'alex', type: 'other', schedule: 'quarterly', amountCents: 1_000_00 },
    ]
    const household = estimateHouseholdTax(multi, [], FY2027_CONFIG)
    // $5,000 × 12 + $1,000 × 4 = $64,000.
    expect(household.members).toHaveLength(1)
    expect(household.members[0]!.annualGrossCents).toBe(64_000_00)
  })

  it('defaults a member with income but no profile to a cover-less resident', () => {
    const household = estimateHouseholdTax(
      [{ memberId: 'jo', type: 'salary', schedule: 'annual', amountCents: 200_000_00 }],
      [],
      FY2027_CONFIG,
    )
    const jo = household.members[0]!
    // No cover by default, so the top surcharge tier applies: 1.5% × $200,000.
    expect(jo.breakdown.medicareLevySurchargeCents).toBe(3_000_00)
  })

  it('yields a zero estimate for a member with a profile but no income', () => {
    const household = estimateHouseholdTax(
      [],
      [
        {
          memberId: 'pat',
          residency: 'resident',
          privateHospitalCover: false,
          helpDebtCents: 5_000_00,
        },
      ],
      FY2027_CONFIG,
    )
    expect(household.members).toEqual([
      expect.objectContaining({
        memberId: 'pat',
        annualGrossCents: 0,
        annualTaxCents: 0,
        annualAfterTaxCents: 0,
        fortnightlyGrossCents: 0,
        fortnightlyTaxCents: 0,
        fortnightlyAfterTaxCents: 0,
      }),
    ])
  })
})
