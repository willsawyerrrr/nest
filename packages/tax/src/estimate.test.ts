import { describe, expect, it } from 'vitest'
import {
  annualGrossCents,
  estimateHouseholdTax,
  FY2027_CONFIG,
  type IncomeInput,
  type IncomeSchedule,
  type TaxProfileInput,
} from './index'

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

  it('annualises the every_n_weeks cadence as round(perPeriod × 52 / interval)', () => {
    expect(
      annualGrossCents({ memberId: 'm', type: 'salary', schedule: 'every_n_weeks', interval: 1 }),
    ).toBe(0)
    expect(
      annualGrossCents({
        memberId: 'm',
        type: 'salary',
        schedule: 'every_n_weeks',
        amountCents: 1_000_00,
        interval: 1,
      }),
    ).toBe(52_000_00)
    expect(
      annualGrossCents({
        memberId: 'm',
        type: 'salary',
        schedule: 'every_n_weeks',
        amountCents: 1_000_00,
        interval: 2,
      }),
    ).toBe(26_000_00)
    // round(100_00 × 52 / 3) = round(173_333.33) = 173_333.
    expect(
      annualGrossCents({
        memberId: 'm',
        type: 'salary',
        schedule: 'every_n_weeks',
        amountCents: 100_00,
        interval: 3,
      }),
    ).toBe(173_333)
  })

  it('annualises the every_n_months cadence as round(perPeriod × 12 / interval)', () => {
    // n=1 equals monthly.
    expect(
      annualGrossCents({
        memberId: 'm',
        type: 'salary',
        schedule: 'every_n_months',
        amountCents: 1_000_00,
        interval: 1,
      }),
    ).toBe(12_000_00)
    // n=12 equals annual.
    expect(
      annualGrossCents({
        memberId: 'm',
        type: 'salary',
        schedule: 'every_n_months',
        amountCents: 1_000_00,
        interval: 12,
      }),
    ).toBe(1_000_00)
    // round(1_000_00 × 12 / 7) = round(171_428.57) = 171_429.
    expect(
      annualGrossCents({
        memberId: 'm',
        type: 'salary',
        schedule: 'every_n_months',
        amountCents: 1_000_00,
        interval: 7,
      }),
    ).toBe(171_429)
  })

  it('annualises the interpolated cadences to zero for a missing or invalid interval', () => {
    for (const schedule of ['every_n_weeks', 'every_n_months'] as const) {
      expect(
        annualGrossCents({ memberId: 'm', type: 'salary', schedule, amountCents: 1_000_00 }),
      ).toBe(0)
      expect(
        annualGrossCents({
          memberId: 'm',
          type: 'salary',
          schedule,
          amountCents: 1_000_00,
          interval: 0,
        }),
      ).toBe(0)
      expect(
        annualGrossCents({
          memberId: 'm',
          type: 'salary',
          schedule,
          amountCents: 1_000_00,
          interval: -3,
        }),
      ).toBe(0)
      expect(
        annualGrossCents({
          memberId: 'm',
          type: 'salary',
          schedule,
          amountCents: 1_000_00,
          interval: 2.5,
        }),
      ).toBe(0)
    }
  })
})

describe('annualGrossCents for a one-off', () => {
  const bonus: IncomeInput = {
    memberId: 'm',
    type: 'other',
    amountCents: 26_000_00,
    paidOn: '2026-09-01',
  }

  it('takes the whole amount, unannualised, for a payment landing in the year', () => {
    expect(annualGrossCents(bonus, 2027)).toBe(26_000_00)
  })

  it('takes nothing for a payment landing outside the year', () => {
    expect(annualGrossCents({ ...bonus, paidOn: '2027-08-01' }, 2027)).toBe(0)
    expect(annualGrossCents({ ...bonus, paidOn: '2026-06-30' }, 2027)).toBe(0)
  })

  it('takes the whole amount whatever year it lands in when no year is given', () => {
    expect(annualGrossCents(bonus)).toBe(26_000_00)
    expect(annualGrossCents({ ...bonus, paidOn: '2030-01-01' })).toBe(26_000_00)
  })

  it('ignores an effective window on a one-off, which lands on a day rather than accruing', () => {
    expect(annualGrossCents({ ...bonus, startsOn: '2020-01-01', endsOn: '2020-12-31' }, 2027)).toBe(
      26_000_00,
    )
  })

  it('annualises a recurring income with no schedule to zero', () => {
    expect(annualGrossCents({ memberId: 'm', type: 'salary', amountCents: 1_000_00 })).toBe(0)
  })
})

describe('estimateHouseholdTax with one-off payments', () => {
  /** A covered resident, so the family surcharge cannot move between comparisons. */
  const covered: TaxProfileInput[] = [
    { memberId: 'm', residency: 'resident', privateHospitalCover: true, helpDebtCents: 0 },
  ]
  const salaryOf = (amountCents: number): IncomeInput => ({
    memberId: 'm',
    type: 'salary',
    schedule: 'annual',
    amountCents,
  })
  const oneOff = (amountCents: number, overrides: Partial<IncomeInput> = {}): IncomeInput => ({
    memberId: 'm',
    type: 'other',
    amountCents,
    paidOn: '2026-09-01',
    ...overrides,
  })
  const memberOf = (household: ReturnType<typeof estimateHouseholdTax>) => household.members[0]!

  it('taxes an ordinary one-off exactly as the same money earned steadily', () => {
    const withBonus = estimateHouseholdTax(
      [salaryOf(100_000_00), oneOff(26_000_00, { treatment: 'ordinary' })],
      covered,
      FY2027_CONFIG,
    )
    const asSalary = estimateHouseholdTax([salaryOf(126_000_00)], covered, FY2027_CONFIG)
    expect(memberOf(withBonus).annualGrossCents).toBe(126_000_00)
    expect(memberOf(withBonus).annualTaxCents).toBe(memberOf(asSalary).annualTaxCents)
    expect(memberOf(withBonus).breakdown.oneOffOffsetCents).toBe(0)
  })

  it('reads an absent treatment as ordinary', () => {
    const untreated = estimateHouseholdTax(
      [salaryOf(100_000_00), oneOff(26_000_00)],
      covered,
      FY2027_CONFIG,
    )
    const ordinary = estimateHouseholdTax(
      [salaryOf(100_000_00), oneOff(26_000_00, { treatment: 'ordinary' })],
      covered,
      FY2027_CONFIG,
    )
    expect(memberOf(untreated).annualTaxCents).toBe(memberOf(ordinary).annualTaxCents)
  })

  it('keeps one-off money in the annual figures and out of the fortnightly ones', () => {
    const household = estimateHouseholdTax(
      [salaryOf(100_000_00), oneOff(26_000_00, { treatment: 'ordinary' })],
      covered,
      FY2027_CONFIG,
    )
    const recurringOnly = estimateHouseholdTax([salaryOf(100_000_00)], covered, FY2027_CONFIG)
    const member = memberOf(household)
    expect(member.annualOneOffGrossCents).toBe(26_000_00)
    // The fortnightly figures are the recurring year over 26, the one-off nowhere in
    // them; the annual figures carry it in full.
    expect(member.fortnightlyGrossCents).toBe(Math.round(100_000_00 / 26))
    expect(member.fortnightlyGrossCents).toBe(memberOf(recurringOnly).fortnightlyGrossCents)
    expect(member.annualGrossCents - member.annualOneOffGrossCents).toBe(100_000_00)
    expect(member.fortnightlyAfterTaxCents).toBe(
      Math.round((member.annualAfterTaxCents - member.annualOneOffAfterTaxCents) / 26),
    )
    expect(member.fortnightlyTaxCents).toBeLessThan(Math.round(member.annualTaxCents / 26))
  })

  it('reports nil one-off figures for a member with only recurring income', () => {
    const member = memberOf(estimateHouseholdTax([salaryOf(100_000_00)], covered, FY2027_CONFIG))
    expect(member.annualOneOffGrossCents).toBe(0)
    expect(member.annualOneOffAfterTaxCents).toBe(0)
    expect(member.fortnightlyGrossCents).toBe(Math.round(member.annualGrossCents / 26))
  })

  it('excludes a redundancy’s tax-free amount from income and offsets the rest', () => {
    // FY2027 tax-free = $13,598 + 5 × $6,801 = $47,603 of the $100,000 payment,
    // leaving $52,397 assessable on top of a $100,000 salary.
    const household = estimateHouseholdTax(
      [
        salaryOf(100_000_00),
        oneOff(100_000_00, { treatment: 'genuineRedundancy', yearsOfService: 5 }),
      ],
      covered,
      FY2027_CONFIG,
    )
    const member = memberOf(household)
    expect(member.input.assessableIncome.employmentTerminationCents).toBe(52_397_00)
    expect(member.breakdown.taxableIncomeCents).toBe(152_397_00)
    expect(member.annualGrossCents).toBe(200_000_00)
    expect(member.annualOneOffGrossCents).toBe(100_000_00)
    // Marginal tax on the $52,397 slice is $16,936.89; 30% of it is $15,719.10.
    expect(member.breakdown.oneOffOffsetCents).toBe(1_217_79)
  })

  it('counts only the base tax-free limit for a redundancy stating no years of service', () => {
    const member = memberOf(
      estimateHouseholdTax(
        [oneOff(100_000_00, { treatment: 'genuineRedundancy' })],
        covered,
        FY2027_CONFIG,
      ),
    )
    expect(member.input.assessableIncome.employmentTerminationCents).toBe(100_000_00 - 13_598_00)
  })

  it('taxes a member at or above preservation age less on the same payment', () => {
    const payment = { treatment: 'employmentTermination' } as const
    const below = estimateHouseholdTax(
      [salaryOf(100_000_00), oneOff(50_000_00, payment)],
      covered,
      FY2027_CONFIG,
    )
    const atAge = estimateHouseholdTax(
      [salaryOf(100_000_00), oneOff(50_000_00, { ...payment, atPreservationAge: true })],
      covered,
      FY2027_CONFIG,
    )
    expect(memberOf(atAge).annualTaxCents).toBeLessThan(memberOf(below).annualTaxCents)
    expect(memberOf(atAge).annualOneOffAfterTaxCents).toBeGreaterThan(
      memberOf(below).annualOneOffAfterTaxCents,
    )
  })

  it('gives a non-excluded payment no concession once salary exhausts the headroom', () => {
    // A $200,000 salary is already past the $180,000 whole-of-income cap.
    const member = memberOf(
      estimateHouseholdTax(
        [salaryOf(200_000_00), oneOff(50_000_00, { treatment: 'employmentTermination' })],
        covered,
        FY2027_CONFIG,
      ),
    )
    expect(member.input.oneOffConcessions).toEqual([{ concessionalCents: 0, rate: 0.3 }])
    expect(member.breakdown.oneOffOffsetCents).toBe(0)
  })

  it('shares the whole-of-income headroom between two payments in one year', () => {
    // $100,000 of salary leaves $80,000 of the $180,000 cap for the termination
    // payment; the unused leave that follows is concessional in full at its own rate.
    const member = memberOf(
      estimateHouseholdTax(
        [
          salaryOf(100_000_00),
          oneOff(100_000_00, { treatment: 'employmentTermination' }),
          oneOff(20_000_00, { treatment: 'unusedLeave' }),
        ],
        covered,
        FY2027_CONFIG,
      ),
    )
    expect(member.input.oneOffConcessions).toEqual([
      { concessionalCents: 80_000_00, rate: 0.3 },
      { concessionalCents: 20_000_00, rate: 0.3 },
    ])
    expect(member.breakdown.taxableIncomeCents).toBe(220_000_00)
    expect(member.annualOneOffGrossCents).toBe(120_000_00)
  })

  it('measures the headroom against taxable income, net of deductions and super', () => {
    // $200,000 of salary less $10,000 of deductions and $30,000 of concessional super
    // is $160,000 of taxable income, leaving $20,000 of the $180,000 cap.
    const member = memberOf(
      estimateHouseholdTax(
        [salaryOf(200_000_00), oneOff(50_000_00, { treatment: 'employmentTermination' })],
        covered,
        FY2027_CONFIG,
        new Map([['m', 30_000_00]]),
        new Map([['m', 10_000_00]]),
      ),
    )
    expect(member.input.oneOffConcessions).toEqual([{ concessionalCents: 20_000_00, rate: 0.3 }])
  })

  it('excludes a one-off paid outside the financial year entirely', () => {
    const household = estimateHouseholdTax(
      [
        salaryOf(100_000_00),
        oneOff(100_000_00, { treatment: 'genuineRedundancy', paidOn: '2027-08-01' }),
      ],
      covered,
      FY2027_CONFIG,
    )
    const recurringOnly = estimateHouseholdTax([salaryOf(100_000_00)], covered, FY2027_CONFIG)
    expect(memberOf(household).annualOneOffGrossCents).toBe(0)
    expect(memberOf(household).annualGrossCents).toBe(100_000_00)
    expect(memberOf(household).annualTaxCents).toBe(memberOf(recurringOnly).annualTaxCents)
  })

  it('reports what the member keeps of a one-off as the liability it adds', () => {
    const incomes = [
      salaryOf(100_000_00),
      oneOff(100_000_00, { treatment: 'genuineRedundancy', yearsOfService: 5 }),
    ]
    const member = memberOf(estimateHouseholdTax(incomes, covered, FY2027_CONFIG))
    const recurringOnly = memberOf(
      estimateHouseholdTax([salaryOf(100_000_00)], covered, FY2027_CONFIG),
    )
    expect(member.annualOneOffAfterTaxCents).toBe(
      100_000_00 - (member.annualTaxCents - recurringOnly.annualTaxCents),
    )
    // The tax-free half means the member keeps more than half of it.
    expect(member.annualOneOffAfterTaxCents).toBeGreaterThan(50_000_00)
    expect(member.annualOneOffAfterTaxCents).toBeLessThan(100_000_00)
  })

  it('keeps a wholly tax-free redundancy whole', () => {
    // $40,000 after 5 years is under the $47,603 tax-free amount, so it adds no
    // assessable income and costs no tax at all.
    const member = memberOf(
      estimateHouseholdTax(
        [
          salaryOf(100_000_00),
          oneOff(40_000_00, { treatment: 'genuineRedundancy', yearsOfService: 5 }),
        ],
        covered,
        FY2027_CONFIG,
      ),
    )
    expect(member.input.assessableIncome.employmentTerminationCents).toBe(0)
    expect(member.annualOneOffAfterTaxCents).toBe(40_000_00)
  })

  it('sums the one-off figures across the household', () => {
    const household = estimateHouseholdTax(
      [
        { ...salaryOf(100_000_00), memberId: 'alex' },
        { ...oneOff(50_000_00, { treatment: 'ordinary' }), memberId: 'alex' },
        { ...salaryOf(80_000_00), memberId: 'sam' },
        {
          ...oneOff(60_000_00, { treatment: 'genuineRedundancy', yearsOfService: 2 }),
          memberId: 'sam',
        },
      ],
      [
        { memberId: 'alex', residency: 'resident', privateHospitalCover: true, helpDebtCents: 0 },
        { memberId: 'sam', residency: 'resident', privateHospitalCover: true, helpDebtCents: 0 },
      ],
      FY2027_CONFIG,
    )
    const sumOf = (pick: (m: (typeof household.members)[number]) => number) =>
      household.members.reduce((total, m) => total + pick(m), 0)
    expect(household.annualOneOffGrossCents).toBe(110_000_00)
    expect(household.annualOneOffGrossCents).toBe(sumOf((m) => m.annualOneOffGrossCents))
    expect(household.annualOneOffAfterTaxCents).toBe(sumOf((m) => m.annualOneOffAfterTaxCents))
    // The household's annual gross carries the one-offs; its fortnightly gross does not.
    expect(household.annualGrossCents).toBe(290_000_00)
    expect(household.fortnightlyGrossCents).toBe(
      Math.round(100_000_00 / 26) + Math.round(80_000_00 / 26),
    )
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

  it('reduces taxable income and after-tax cash by concessional super contributions', () => {
    const concessional = new Map([['alex', 20_000_00]])
    const household = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG, concessional)
    const baseline = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG)
    const alex = household.members.find((m) => m.memberId === 'alex')!
    const alexBase = baseline.members.find((m) => m.memberId === 'alex')!

    expect(alex.annualConcessionalContributionsCents).toBe(20_000_00)
    // The engine input is exposed for re-running what-ifs, carrying the concessional total.
    expect(alex.input.concessionalContributionsCents).toBe(20_000_00)
    expect(alex.input.assessableIncome.salaryOrWagesCents).toBe(alex.annualGrossCents)
    // Taxable income drops by the contribution, so tax is lower than the baseline.
    expect(alex.breakdown.taxableIncomeCents).toBe(
      alexBase.breakdown.taxableIncomeCents - 20_000_00,
    )
    expect(alex.annualTaxCents).toBeLessThan(alexBase.annualTaxCents)
    // After-tax cash is gross less the contribution less tax.
    expect(alex.annualAfterTaxCents).toBe(alex.annualGrossCents - 20_000_00 - alex.annualTaxCents)
    // Sam, with no contribution supplied, is unaffected.
    const sam = household.members.find((m) => m.memberId === 'sam')!
    expect(sam.annualConcessionalContributionsCents).toBe(0)
  })

  it('nets concessional super of the 15% contributions tax', () => {
    const concessional = new Map([['alex', 20_000_00]])
    const household = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG, concessional)
    const alex = household.members.find((m) => m.memberId === 'alex')!
    const netRate = 1 - FY2027_CONFIG.super.contributionsTaxRate
    expect(alex.annualNetConcessionalSuperCents).toBe(Math.round(20_000_00 * netRate))
  })

  it('reduces taxable income and lowers tax without cutting after-tax cash for deductions', () => {
    const deductions = new Map([['alex', 10_000_00]])
    const household = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG, undefined, deductions)
    const baseline = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG)
    const alex = household.members.find((m) => m.memberId === 'alex')!
    const alexBase = baseline.members.find((m) => m.memberId === 'alex')!

    expect(alex.annualDeductionsCents).toBe(10_000_00)
    // Taxable income drops by the deduction, so tax falls below the baseline.
    expect(alex.breakdown.taxableIncomeCents).toBe(
      alexBase.breakdown.taxableIncomeCents - 10_000_00,
    )
    expect(alex.annualTaxCents).toBeLessThan(alexBase.annualTaxCents)
    // Unlike a concessional contribution, a deduction is not diverted from cash,
    // so after-tax cash rises (less tax) rather than falling by the deduction.
    expect(alex.annualAfterTaxCents).toBe(alex.annualGrossCents - alex.annualTaxCents)
    expect(alex.annualAfterTaxCents).toBeGreaterThanOrEqual(alexBase.annualAfterTaxCents)
    // Sam, with no deduction supplied, is unaffected.
    const sam = household.members.find((m) => m.memberId === 'sam')!
    expect(sam.annualDeductionsCents).toBe(0)
    // The household deductions total is the sum of its members'.
    expect(household.annualDeductionsCents).toBe(10_000_00)
  })

  it('leaves each member’s balance their bare liability with no withholding supplied', () => {
    const household = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG)
    for (const member of household.members) {
      expect(member.breakdown.paygWithheldCents).toBe(0)
      expect(member.breakdown.balanceCents).toBe(member.annualTaxCents)
    }
  })

  it('nets a member’s actual withholding against their liability as an amount owing', () => {
    const withheld = new Map([['alex', 40_000_00]])
    const household = estimateHouseholdTax(
      incomes,
      profiles,
      FY2027_CONFIG,
      undefined,
      undefined,
      withheld,
    )
    const alex = household.members.find((m) => m.memberId === 'alex')!
    expect(alex.breakdown.paygWithheldCents).toBe(40_000_00)
    // Alex's liability exceeds what was withheld, so the balance is owing.
    expect(alex.breakdown.balanceCents).toBe(alex.annualTaxCents - 40_000_00)
    expect(alex.breakdown.balanceCents).toBeGreaterThan(0)
    // Sam, absent from the map, keeps nil withholding and an unoffset liability.
    const sam = household.members.find((m) => m.memberId === 'sam')!
    expect(sam.breakdown.paygWithheldCents).toBe(0)
    expect(sam.breakdown.balanceCents).toBe(sam.annualTaxCents)
  })

  it('reports a refund for a member withheld more than their liability', () => {
    const withheld = new Map([['alex', 50_000_00]])
    const household = estimateHouseholdTax(
      incomes,
      profiles,
      FY2027_CONFIG,
      undefined,
      undefined,
      withheld,
    )
    const alex = household.members.find((m) => m.memberId === 'alex')!
    expect(alex.breakdown.balanceCents).toBe(alex.annualTaxCents - 50_000_00)
    expect(alex.breakdown.balanceCents).toBeLessThan(0)
  })

  it('leaves every liability and after-tax figure untouched by the withholding supplied', () => {
    const withheld = new Map([
      ['alex', 40_000_00],
      ['sam', 8_000_00],
    ])
    const household = estimateHouseholdTax(
      incomes,
      profiles,
      FY2027_CONFIG,
      undefined,
      undefined,
      withheld,
    )
    const baseline = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG)
    expect(household.annualGrossCents).toBe(baseline.annualGrossCents)
    expect(household.annualTaxCents).toBe(baseline.annualTaxCents)
    expect(household.annualAfterTaxCents).toBe(baseline.annualAfterTaxCents)
    expect(household.members.map((m) => m.annualTaxCents)).toEqual(
      baseline.members.map((m) => m.annualTaxCents),
    )
  })

  it('sums concessional and net-super figures across members', () => {
    const concessional = new Map([
      ['alex', 20_000_00],
      ['sam', 5_000_00],
    ])
    const household = estimateHouseholdTax(incomes, profiles, FY2027_CONFIG, concessional)
    const sumOf = (pick: (m: (typeof household.members)[number]) => number) =>
      household.members.reduce((total, m) => total + pick(m), 0)
    expect(household.annualConcessionalContributionsCents).toBe(
      sumOf((m) => m.annualConcessionalContributionsCents),
    )
    expect(household.annualNetConcessionalSuperCents).toBe(
      sumOf((m) => m.annualNetConcessionalSuperCents),
    )
  })

  const soloProfile: TaxProfileInput[] = [
    { memberId: 'm', residency: 'resident', privateHospitalCover: false, helpDebtCents: 0 },
  ]

  it('leaves undated income at its full annual gross', () => {
    const household = estimateHouseholdTax(
      [salary('annual', 100_000_00)],
      soloProfile,
      FY2027_CONFIG,
    )
    expect(household.annualGrossCents).toBe(100_000_00)
  })

  it('prorates a mid-year pay rise across two adjacent dated incomes', () => {
    // FY2027 is 365 days. Old $90k active 1 Jul–14 Sep (76 days), new $100k active
    // 15 Sep–30 Jun (289 days) — adjacent windows spanning the whole year.
    const oldRate: IncomeInput = { ...salary('annual', 90_000_00), endsOn: '2026-09-14' }
    const newRate: IncomeInput = { ...salary('annual', 100_000_00), startsOn: '2026-09-15' }
    const expected = Math.round((90_000_00 * 76) / 365) + Math.round((100_000_00 * 289) / 365)
    const household = estimateHouseholdTax([oldRate, newRate], soloProfile, FY2027_CONFIG)
    expect(household.annualGrossCents).toBe(expected)
    // The prorated gross lies strictly between the two flat annual rates.
    expect(household.annualGrossCents).toBeGreaterThan(90_000_00)
    expect(household.annualGrossCents).toBeLessThan(100_000_00)
  })

  it('excludes income whose effective window falls entirely outside the year', () => {
    const stale: IncomeInput = {
      ...salary('annual', 100_000_00),
      startsOn: '2025-01-01',
      endsOn: '2025-06-30',
    }
    const household = estimateHouseholdTax([stale], soloProfile, FY2027_CONFIG)
    expect(household.annualGrossCents).toBe(0)
  })

  it('prorates "other" income by its effective window too', () => {
    // Half-year "other" income routes through the otherCents bucket, still prorated.
    const other: IncomeInput = {
      memberId: 'm',
      type: 'other',
      schedule: 'annual',
      amountCents: 40_000_00,
      startsOn: '2027-01-01',
    }
    // 1 Jan–30 Jun 2027 is 181 days of the 365-day FY.
    const expected = Math.round((40_000_00 * 181) / 365)
    const household = estimateHouseholdTax([other], soloProfile, FY2027_CONFIG)
    expect(household.annualGrossCents).toBe(expected)
  })
})

describe('estimateHouseholdTax family Medicare levy surcharge', () => {
  // Combined surcharge income $270,000 sits in the family 1.25% tier ($246k–$328k).
  const coupleIncomes: IncomeInput[] = [
    { memberId: 'alex', type: 'salary', schedule: 'annual', amountCents: 150_000_00 },
    { memberId: 'sam', type: 'salary', schedule: 'annual', amountCents: 120_000_00 },
  ]
  const profile = (memberId: string, privateHospitalCover: boolean): TaxProfileInput => ({
    memberId,
    residency: 'resident',
    privateHospitalCover,
    helpDebtCents: 0,
  })
  const surchargeOf = (household: ReturnType<typeof estimateHouseholdTax>, memberId: string) =>
    household.members.find((m) => m.memberId === memberId)!.breakdown.medicareLevySurchargeCents

  it('charges only the uncovered member, at the family rate on their own income', () => {
    const household = estimateHouseholdTax(
      coupleIncomes,
      [profile('alex', false), profile('sam', true)],
      FY2027_CONFIG,
    )
    // Alex (no cover) pays 1.25% × $150,000; Sam (cover) is exempt.
    expect(surchargeOf(household, 'alex')).toBe(1_875_00)
    expect(surchargeOf(household, 'sam')).toBe(0)
  })

  it('charges both members when neither holds cover', () => {
    const household = estimateHouseholdTax(
      coupleIncomes,
      [profile('alex', false), profile('sam', false)],
      FY2027_CONFIG,
    )
    expect(surchargeOf(household, 'alex')).toBe(1_875_00) // 1.25% × $150,000
    expect(surchargeOf(household, 'sam')).toBe(1_500_00) // 1.25% × $120,000
  })

  it('exempts both members when both hold cover', () => {
    const household = estimateHouseholdTax(
      coupleIncomes,
      [profile('alex', true), profile('sam', true)],
      FY2027_CONFIG,
    )
    expect(surchargeOf(household, 'alex')).toBe(0)
    expect(surchargeOf(household, 'sam')).toBe(0)
  })

  it('charges nothing when combined income is below the family floor, even above a single floor', () => {
    // $120,000 + $85,000 = $205,000 < the $210,000 family floor, though Alex alone
    // exceeds the $105,000 single floor — the assessment is on combined income.
    const household = estimateHouseholdTax(
      [
        { memberId: 'alex', type: 'salary', schedule: 'annual', amountCents: 120_000_00 },
        { memberId: 'sam', type: 'salary', schedule: 'annual', amountCents: 85_000_00 },
      ],
      [profile('alex', false), profile('sam', false)],
      FY2027_CONFIG,
    )
    expect(surchargeOf(household, 'alex')).toBe(0)
    expect(surchargeOf(household, 'sam')).toBe(0)
  })
})
