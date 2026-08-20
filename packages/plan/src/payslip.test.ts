import { describe, expect, it } from 'vitest'
import {
  annualInflowGrossCents,
  expectedPeriodGrossCents,
  isPeriodOnCadence,
  latestReportedYearToDate,
  paygWithheldByMember,
  payslipAttributionDate,
  payslipVariance,
  payslipYearToDate,
  payslipYearToDateByMember,
  unmeasuredInflowPositions,
  type Frequency,
  type Money,
  type PayPeriod,
  type PayslipActuals,
  type PayslipEarningLine,
  type PayslipExpectation,
  type PayslipLine,
  type PayslipTaxLine,
  type PayslipTotalsRow,
  type PayslipVariance,
  type ReconciledInflow,
  type SuperGuaranteeConfig,
  type UnmeasuredPositionRow,
} from './index'

/** FY2027 — 1 Jul 2026 – 30 Jun 2027, 365 days. */
const FY = 2027

/** The first fortnight of FY2027: 14 days, one whole turn of a fortnightly cadence. */
const FORTNIGHT = { periodStart: '2026-07-01', periodEnd: '2026-07-14' } as const

/** A $130,000 salary paid fortnightly — $5,000 a period, $130,000 annualised. */
const SALARY: ReconciledInflow = { type: 'salary', schedule: 'fortnightly', amountCents: 5_000_00 }

/** Super parameters shaped like a `TaxYearConfig`'s, at the 12% guarantee rate. */
const SUPER_CONFIG: SuperGuaranteeConfig = { guaranteeRate: 0.12 }

/** $36,400 a year — $1,400.00 a fortnight and $700.00 a week, both exact. */
const ANNUAL_TAX = 36_400_00

/** $130,000 ÷ 26 — the fortnightly cadence's share of the annualised salary. */
const CADENCE_GROSS = 5_000_00

/** $36,400 ÷ 26. */
const CADENCE_WITHHELD = 1_400_00

/** 12% of $5,000. */
const CADENCE_SUPER = 600_00

/** $36,400 × 14/365 — what a slip with no pay cycle to read expects withheld. */
const DAY_PRORATED_WITHHELD = 1_396_16

/** A monthly $10,000 salary — $120,000 annualised. */
const MONTHLY: ReconciledInflow = { type: 'salary', schedule: 'monthly', amountCents: 10_000_00 }

/**
 * An `every_n_weeks` inflow stating no interval: a cadence with no nominal period
 * length, and so no pay cycle to scale a part period across. The database forbids
 * it, but the shape allows it and the math has to answer for it.
 */
const NO_INTERVAL: ReconciledInflow = { type: 'salary', schedule: 'every_n_weeks' }

/** One earnings line drawing on the salary, which every default slip is itemised as. */
function salaryLine(amountCents: Money): PayslipEarningLine {
  return { kind: 'earning', sourceInflowId: 'salary', label: 'Ordinary Hours', amountCents }
}

/**
 * A payslip on cadence and matching the plan exactly, before any override.
 * Itemised as one salary line for its whole gross unless the override says
 * otherwise, since the lines are what a slip is measured through.
 */
function payslip(overrides: Partial<PayslipActuals> = {}): PayslipActuals {
  const slip = {
    financialYear: FY,
    ...FORTNIGHT,
    grossCents: CADENCE_GROSS,
    taxWithheldCents: CADENCE_WITHHELD,
    superCents: CADENCE_SUPER,
    ...overrides,
  }
  return { ...slip, lines: overrides.lines ?? [salaryLine(slip.grossCents)] }
}

/** The plan's expectation for that payslip, before any override. */
function expectation(overrides: Partial<PayslipExpectation> = {}): PayslipExpectation {
  return {
    inflowsById: new Map([['salary', SALARY]]),
    annualTaxCents: ANNUAL_TAX,
    superConfig: SUPER_CONFIG,
    ...overrides,
  }
}

/** The one-inflow map an expectation reads, keyed as the slip's lines name it. */
function inflowsById(inflow: ReconciledInflow): ReadonlyMap<string, ReconciledInflow> {
  return new Map([['salary', inflow]])
}

/** A payslip row for year-to-date aggregation. */
function row(overrides: Partial<PayslipTotalsRow> = {}): PayslipTotalsRow {
  return {
    memberId: 'alex',
    periodEnd: '2026-07-14',
    grossCents: 5_000_00,
    taxWithheldCents: 1_400_00,
    superCents: 600_00,
    ...overrides,
  }
}

/** A period running `periodStart` through `periodEnd`, both inclusive. */
function period(periodStart: string, periodEnd: string): PayPeriod {
  return { periodStart, periodEnd }
}

describe('payslipAttributionDate', () => {
  it('takes the date the pay landed where the slip states one', () => {
    // Worked to 28 June, paid 1 July: the money landed in the later year.
    expect(payslipAttributionDate({ paidOn: '2026-07-01', periodEnd: '2026-06-28' })).toBe(
      '2026-07-01',
    )
  })

  it('falls back to the period end where the slip states no payment date', () => {
    expect(payslipAttributionDate({ paidOn: null, periodEnd: '2026-06-28' })).toBe('2026-06-28')
    expect(payslipAttributionDate({ periodEnd: '2026-06-28' })).toBe('2026-06-28')
  })
})

describe('annualInflowGrossCents', () => {
  it('annualises a salary’s per-period amount', () => {
    expect(annualInflowGrossCents(SALARY)).toBe(130_000_00)
  })

  it('annualises other income like salary', () => {
    expect(
      annualInflowGrossCents({ type: 'other', schedule: 'monthly', amountCents: 500_00 }),
    ).toBe(6_000_00)
  })

  it('annualises a wage from its hourly rate and hours per period', () => {
    // $50/hr × 76 h/fortnight = $3,800 a fortnight × 26 = $98,800/yr.
    expect(
      annualInflowGrossCents({
        type: 'wage',
        schedule: 'fortnightly',
        hourlyRateCents: 50_00,
        hoursPerPeriod: 76,
      }),
    ).toBe(98_800_00)
  })

  it('treats missing amounts, rates, and hours as zero', () => {
    expect(annualInflowGrossCents({ type: 'salary', schedule: 'fortnightly' })).toBe(0)
    expect(annualInflowGrossCents({ type: 'wage', schedule: 'fortnightly' })).toBe(0)
    expect(
      annualInflowGrossCents({ type: 'wage', schedule: 'fortnightly', hourlyRateCents: 50_00 }),
    ).toBe(0)
  })

  it('annualises an arbitrary cadence through its interval', () => {
    expect(
      annualInflowGrossCents({
        type: 'salary',
        schedule: 'every_n_weeks',
        amountCents: 1_000_00,
        interval: 4,
      }),
    ).toBe(13_000_00)
  })

  it('annualises an inflow stating no schedule to zero', () => {
    // The row a one-off stores states none, and nothing else has a period to
    // multiply an amount up from either.
    expect(annualInflowGrossCents({ type: 'salary', amountCents: 5_000_00 })).toBe(0)
  })

  it('annualises an arbitrary cadence with no interval to zero', () => {
    expect(
      annualInflowGrossCents({ type: 'salary', schedule: 'every_n_weeks', amountCents: 1_000_00 }),
    ).toBe(0)
  })
})

describe('isPeriodOnCadence', () => {
  /** A $1-a-period inflow on `schedule`; the amount is irrelevant to the cadence. */
  function on(schedule: Frequency, interval?: number): ReconciledInflow {
    return {
      type: 'salary',
      schedule,
      amountCents: 1_00,
      ...(interval !== undefined && { interval }),
    }
  }

  it('recognises a week-based period at exactly seven days a week', () => {
    expect(isPeriodOnCadence(on('weekly'), period('2026-07-01', '2026-07-07'))).toBe(true)
    expect(isPeriodOnCadence(on('fortnightly'), FORTNIGHT)).toBe(true)
    // Three weeks: 1–21 July.
    expect(isPeriodOnCadence(on('every_n_weeks', 3), period('2026-07-01', '2026-07-21'))).toBe(true)
  })

  it('rejects a week-based period even one day off its exact length', () => {
    expect(isPeriodOnCadence(on('weekly'), period('2026-07-01', '2026-07-06'))).toBe(false)
    expect(isPeriodOnCadence(on('weekly'), period('2026-07-01', '2026-07-08'))).toBe(false)
    // 13 days, one short of a fortnight — a part period, not a whole one.
    expect(isPeriodOnCadence(on('fortnightly'), period('2026-07-01', '2026-07-13'))).toBe(false)
  })

  it('accepts every real calendar month on a monthly cadence', () => {
    // The longest month, 31 days.
    expect(isPeriodOnCadence(on('monthly'), period('2026-07-01', '2026-07-31'))).toBe(true)
    // The shortest, February's 28 days.
    expect(isPeriodOnCadence(on('monthly'), period('2027-02-01', '2027-02-28'))).toBe(true)
    // A leap February's 29.
    expect(isPeriodOnCadence(on('monthly'), period('2028-02-01', '2028-02-29'))).toBe(true)
    // And a 30-day month.
    expect(isPeriodOnCadence(on('monthly'), period('2026-09-01', '2026-09-30'))).toBe(true)
  })

  it('rejects a monthly period shorter or longer than any calendar month', () => {
    // 27 days, one short of the shortest month.
    expect(isPeriodOnCadence(on('monthly'), period('2026-07-01', '2026-07-27'))).toBe(false)
    // 32 days, one longer than the longest.
    expect(isPeriodOnCadence(on('monthly'), period('2026-07-01', '2026-08-01'))).toBe(false)
  })

  it('scales the calendar-month bounds by the months in a longer cadence', () => {
    // A quarter of 92 days (Jul–Sep), a half-year of 184 (Jul–Dec), a year of 365.
    expect(isPeriodOnCadence(on('quarterly'), period('2026-07-01', '2026-09-30'))).toBe(true)
    expect(isPeriodOnCadence(on('biannual'), period('2026-07-01', '2026-12-31'))).toBe(true)
    expect(isPeriodOnCadence(on('annual'), period('2026-07-01', '2027-06-30'))).toBe(true)
    // Two months, 1 Jul – 31 Aug: 62 days, the longest a two-month period runs.
    expect(isPeriodOnCadence(on('every_n_months', 2), period('2026-07-01', '2026-08-31'))).toBe(
      true,
    )
    // One month is not a quarter.
    expect(isPeriodOnCadence(on('quarterly'), period('2026-07-01', '2026-07-31'))).toBe(false)
  })

  it('treats a period the inflow’s effective dates clip as a part period', () => {
    expect(isPeriodOnCadence({ ...SALARY, startsOn: '2026-07-08' }, FORTNIGHT)).toBe(false)
    expect(isPeriodOnCadence({ ...SALARY, endsOn: '2026-07-07' }, FORTNIGHT)).toBe(false)
    // Dates spanning the whole period leave it on cadence.
    expect(
      isPeriodOnCadence({ ...SALARY, startsOn: '2026-07-01', endsOn: '2026-07-14' }, FORTNIGHT),
    ).toBe(true)
  })

  it('is never on cadence for an arbitrary cadence with no usable interval', () => {
    expect(isPeriodOnCadence(on('every_n_weeks'), FORTNIGHT)).toBe(false)
    expect(isPeriodOnCadence(on('every_n_months'), FORTNIGHT)).toBe(false)
  })

  it('is never on cadence for an inflow stating no schedule at all', () => {
    expect(isPeriodOnCadence({ type: 'salary', amountCents: 1_00 }, FORTNIGHT)).toBe(false)
  })

  it('is not on cadence for a period ending before it starts', () => {
    expect(isPeriodOnCadence(SALARY, period('2026-07-14', '2026-07-01'))).toBe(false)
  })
})

describe('expectedPeriodGrossCents', () => {
  it('divides the annualised gross by the periods per year on cadence', () => {
    // $130,000 ÷ 26 — what the employer pays each fortnight, not 14/365 of the year.
    expect(expectedPeriodGrossCents(SALARY, FORTNIGHT, FY)).toBe(CADENCE_GROSS)
  })

  it('treats null effective dates as an unbounded window, so still on cadence', () => {
    expect(
      expectedPeriodGrossCents({ ...SALARY, startsOn: null, endsOn: null }, FORTNIGHT, FY),
    ).toBe(CADENCE_GROSS)
  })

  it('scales a part period across one turn of the pay cycle', () => {
    // 13 of a fortnight's 14 days: $5,000 × 13/14 = $4,642.857… → $4,642.86, not
    // the $4,630.14 a 13/365 share of the year would give.
    expect(expectedPeriodGrossCents(SALARY, period('2026-07-01', '2026-07-13'), FY)).toBe(4_642_86)
  })

  it('steps by one day of the pay period either side of a whole turn', () => {
    // The two paths meet at 14 days: a day short is a day's worth less and a day
    // over a day's worth more, in even $357.14 steps with no jump at the boundary.
    expect(expectedPeriodGrossCents(SALARY, period('2026-07-01', '2026-07-13'), FY)).toBe(4_642_86)
    expect(expectedPeriodGrossCents(SALARY, FORTNIGHT, FY)).toBe(CADENCE_GROSS)
    expect(expectedPeriodGrossCents(SALARY, period('2026-07-01', '2026-07-15'), FY)).toBe(5_357_14)
  })

  it('counts only the days from an inflow’s effective start', () => {
    // Active 8–14 July: 7 of a fortnight's 14 days, so exactly half of $5,000.
    expect(expectedPeriodGrossCents({ ...SALARY, startsOn: '2026-07-08' }, FORTNIGHT, FY)).toBe(
      2_500_00,
    )
  })

  it('counts only the days through an inflow’s effective end', () => {
    // Active 1–7 July: the inclusive complement of the window above.
    expect(expectedPeriodGrossCents({ ...SALARY, endsOn: '2026-07-07' }, FORTNIGHT, FY)).toBe(
      2_500_00,
    )
  })

  it('has two adjacent dated inflows sum to exactly the whole period’s amount', () => {
    // A mid-period pay rise: the old rate ends 7 July, the new rate starts 8 July.
    // Both are part periods, and because each is a share of one pay period the two
    // sum to the whole period's pay rather than to a share of the year.
    const ending = expectedPeriodGrossCents({ ...SALARY, endsOn: '2026-07-07' }, FORTNIGHT, FY)
    const starting = expectedPeriodGrossCents({ ...SALARY, startsOn: '2026-07-08' }, FORTNIGHT, FY)
    expect(ending! + starting!).toBe(CADENCE_GROSS)
  })

  it('scales a part month across the calendar month the period starts in', () => {
    // 15 of July's 31 days: $10,000 × 15/31 = $4,838.709… → $4,838.71, a shade
    // under half because a day is a smaller share of a long month.
    expect(expectedPeriodGrossCents(MONTHLY, period('2026-07-01', '2026-07-15'), FY)).toBe(4_838_71)
    // 14 of February's 28: exactly half, since February is exactly two fortnights.
    expect(expectedPeriodGrossCents(MONTHLY, period('2027-02-01', '2027-02-14'), FY)).toBe(5_000_00)
  })

  it('clamps a month-based turn beginning on a day the next month lacks', () => {
    // A turn from 31 January ends 27 February, so it is 28 days — not the 31 a
    // rollover into March would make it. Half of it is exactly half a month's pay.
    expect(expectedPeriodGrossCents(MONTHLY, period('2027-01-31', '2027-02-13'), FY)).toBe(5_000_00)
  })

  it('apportions over the financial year for a cadence with no nominal length', () => {
    // No interval means no pay cycle to scale across, so calendar days of the year
    // are all that is left — and the same missing interval annualises to nothing,
    // so there is nothing to apportion either way.
    expect(expectedPeriodGrossCents({ ...NO_INTERVAL, amountCents: 5_000_00 }, FORTNIGHT, FY)).toBe(
      0,
    )
  })

  it('expects nothing from an inflow whose window misses the period', () => {
    expect(expectedPeriodGrossCents({ ...SALARY, endsOn: '2026-06-30' }, FORTNIGHT, FY)).toBe(0)
  })
})

describe('a pay cadence apart from the amount’s own frequency', () => {
  /** The household's case: a $130,000 salary defined per year and paid fortnightly. */
  const YEARLY_PAID_FORTNIGHTLY: ReconciledInflow = {
    type: 'salary',
    schedule: 'annual',
    amountCents: 130_000_00,
    paySchedule: 'fortnightly',
  }

  it('annualises on the amount’s own frequency, the pay cadence changing nothing', () => {
    expect(annualInflowGrossCents(YEARLY_PAID_FORTNIGHTLY)).toBe(130_000_00)
    expect(annualInflowGrossCents({ ...YEARLY_PAID_FORTNIGHTLY, paySchedule: null })).toBe(
      130_000_00,
    )
  })

  it('makes a fortnight one whole turn of the cycle, not part of a year', () => {
    expect(isPeriodOnCadence(YEARLY_PAID_FORTNIGHTLY, FORTNIGHT)).toBe(true)
    // Without the pay cadence the annual schedule is read as the arrival cadence, and a
    // fortnight is only part of its 365-day turn.
    expect(isPeriodOnCadence({ ...YEARLY_PAID_FORTNIGHTLY, paySchedule: null }, FORTNIGHT)).toBe(
      false,
    )
  })

  it('expects the annual figure over 26 for a fortnight, not its calendar-day share', () => {
    expect(expectedPeriodGrossCents(YEARLY_PAID_FORTNIGHTLY, FORTNIGHT, FY)).toBe(5_000_00)
    // $130,000 × 14/365 — what reading the annual schedule as the pay cycle produced.
    expect(
      expectedPeriodGrossCents({ ...YEARLY_PAID_FORTNIGHTLY, paySchedule: null }, FORTNIGHT, FY),
    ).toBe(4_986_30)
  })

  it('holds a part period against a turn of the pay cadence, not of the amount’s frequency', () => {
    // Seven of the fortnight's fourteen days: half a fortnight's pay, not half a year's
    // 14/365 share.
    expect(
      expectedPeriodGrossCents(
        { ...YEARLY_PAID_FORTNIGHTLY, startsOn: '2026-07-08' },
        FORTNIGHT,
        FY,
      ),
    ).toBe(2_500_00)
  })

  it('reads an arbitrary pay cadence through its own interval', () => {
    const everyFourWeeks: ReconciledInflow = {
      type: 'salary',
      schedule: 'annual',
      amountCents: 13_000_00,
      paySchedule: 'every_n_weeks',
      payInterval: 4,
    }
    const fourWeeks = period('2026-07-01', '2026-07-28')
    expect(isPeriodOnCadence(everyFourWeeks, fourWeeks)).toBe(true)
    // 13 payments a year: $13,000 ÷ 13.
    expect(expectedPeriodGrossCents(everyFourWeeks, fourWeeks, FY)).toBe(1_000_00)
    // The amount's own `interval` belongs to `schedule` and is not borrowed here: an
    // arbitrary pay cadence stating no interval has no pay cycle at all.
    expect(
      isPeriodOnCadence({ ...everyFourWeeks, payInterval: null, interval: 4 }, fourWeeks),
    ).toBe(false)
  })

  it('divides a wage’s rate × hours over the cadence the money lands on', () => {
    // $45 × 38 hours a week = $1,710 a week, $88,920 a year, $3,420.00 a fortnight.
    const weeklyHoursPaidFortnightly: ReconciledInflow = {
      type: 'wage',
      schedule: 'weekly',
      hourlyRateCents: 45_00,
      hoursPerPeriod: 38,
      paySchedule: 'fortnightly',
    }
    expect(annualInflowGrossCents(weeklyHoursPaidFortnightly)).toBe(88_920_00)
    expect(expectedPeriodGrossCents(weeklyHoursPaidFortnightly, FORTNIGHT, FY)).toBe(3_420_00)
  })

  it('drops the remainder of an annual figure that will not divide evenly', () => {
    const uneven: ReconciledInflow = {
      type: 'salary',
      schedule: 'annual',
      amountCents: 100_000_00,
      paySchedule: 'fortnightly',
    }
    // $100,000 ÷ 26 = 3_846.1538 → $3,846.15; 26 of those come to $99,999.90. The
    // expectation is a rate to hold one slip against, not an allocation summing to the year.
    expect(expectedPeriodGrossCents(uneven, FORTNIGHT, FY)).toBe(3_846_15)
  })

  it('divides a fortnightly payslip’s withholding and super by the pay cadence too', () => {
    const variance = payslipVariance(
      payslip(),
      expectation({ inflowsById: inflowsById(YEARLY_PAID_FORTNIGHTLY) }),
    )
    expect(variance.basis).toBe('cadence')
    expect(variance.expectedGrossCents).toBe(5_000_00)
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)
    expect(variance.expectedSuperCents).toBe(CADENCE_SUPER)
  })
})

describe('payslipVariance on cadence', () => {
  it('reports exactly zero variance for a fortnightly payslip matching the projection', () => {
    expect(payslipVariance(payslip(), expectation())).toEqual({
      basis: 'cadence',
      partCycleReason: null,
      cadenceInflowId: 'salary',
      periodDays: 14,
      cadencePeriodDays: 14,
      financialYearDays: 365,
      expectedGrossCents: CADENCE_GROSS,
      grossVarianceCents: 0,
      grossPartlyUnmeasured: false,
      unmeasuredGrossCents: 0,
      lineGroups: [
        {
          sourceInflowId: 'salary',
          labels: ['Ordinary Hours'],
          actualCents: CADENCE_GROSS,
          expectedCents: CADENCE_GROSS,
          varianceCents: 0,
          basis: 'cadence',
          partCycleReason: null,
        },
      ],
      unallocatedCents: 0,
      expectedTaxWithheldCents: CADENCE_WITHHELD,
      taxWithheldVarianceCents: 0,
      taxGroups: [],
      unallocatedTaxCents: 0,
      superBaseCents: CADENCE_GROSS,
      expectedSuperGuaranteeCents: CADENCE_SUPER,
      expectedConcessionalCents: 0,
      expectedSuperCents: CADENCE_SUPER,
      actualSuperCents: CADENCE_SUPER,
      superVarianceCents: 0,
    })
  })

  it('reports exactly zero variance for a weekly payslip matching the projection', () => {
    // $2,500 a week → $130,000/yr ÷ 52 = $2,500; $36,400 ÷ 52 = $700; 12% = $300.
    const variance = payslipVariance(
      payslip({
        ...period('2026-07-01', '2026-07-07'),
        grossCents: 2_500_00,
        taxWithheldCents: 700_00,
        superCents: 300_00,
      }),
      expectation({
        inflowsById: inflowsById({ type: 'salary', schedule: 'weekly', amountCents: 2_500_00 }),
      }),
    )
    expect(variance.basis).toBe('cadence')
    expect(variance.expectedGrossCents).toBe(2_500_00)
    expect(variance.grossVarianceCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBe(700_00)
    expect(variance.taxWithheldVarianceCents).toBe(0)
    expect(variance.superVarianceCents).toBe(0)
  })

  it('reports exactly zero variance for a monthly payslip matching the projection', () => {
    // $10,000 a month → $120,000/yr ÷ 12; $36,400 ÷ 12 = $3,033.33; 12% = $1,200.
    const july = payslip({
      ...period('2026-07-01', '2026-07-31'),
      grossCents: 10_000_00,
      taxWithheldCents: 3_033_33,
      superCents: 1_200_00,
    })
    expect(payslipVariance(july, expectation({ inflowsById: inflowsById(MONTHLY) }))).toMatchObject(
      {
        basis: 'cadence',
        partCycleReason: null,
        periodDays: 31,
        expectedGrossCents: 10_000_00,
        grossVarianceCents: 0,
        expectedTaxWithheldCents: 3_033_33,
        taxWithheldVarianceCents: 0,
        superVarianceCents: 0,
      },
    )

    // February's 28 days are a whole month too, so the same figures are expected of
    // it — a shorter month is not a shortfall.
    const february = payslipVariance(
      payslip({ ...july, ...period('2027-02-01', '2027-02-28') }),
      expectation({ inflowsById: inflowsById(MONTHLY) }),
    )
    expect(february.basis).toBe('cadence')
    expect(february.periodDays).toBe(28)
    expect(february.grossVarianceCents).toBe(0)
    expect(february.taxWithheldVarianceCents).toBe(0)
  })

  it('reports exactly zero variance for an every_n_weeks payslip matching the projection', () => {
    // $6,000 every 3 weeks → $104,000/yr, back to $6,000 a period; $36,400 ÷ (52/3)
    // = $2,100; 12% of $6,000 = $720.
    const variance = payslipVariance(
      payslip({
        ...period('2026-07-01', '2026-07-21'),
        grossCents: 6_000_00,
        taxWithheldCents: 2_100_00,
        superCents: 720_00,
      }),
      expectation({
        inflowsById: inflowsById({
          type: 'salary',
          schedule: 'every_n_weeks',
          amountCents: 6_000_00,
          interval: 3,
        }),
      }),
    )
    expect(variance.basis).toBe('cadence')
    expect(variance.expectedGrossCents).toBe(6_000_00)
    expect(variance.grossVarianceCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBe(2_100_00)
    expect(variance.superVarianceCents).toBe(0)
  })

  it('reports a positive withholding variance when the employer over-withholds', () => {
    const variance = payslipVariance(payslip({ taxWithheldCents: 1_600_00 }), expectation())
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)
    expect(variance.taxWithheldVarianceCents).toBe(200_00)
  })

  it('reports a negative withholding variance when the employer under-withholds', () => {
    const variance = payslipVariance(payslip({ taxWithheldCents: 1_200_00 }), expectation())
    expect(variance.taxWithheldVarianceCents).toBe(-200_00)
  })

  it('reports a positive gross variance for a raise the inflow has not caught up with', () => {
    const variance = payslipVariance(payslip({ grossCents: 5_500_00 }), expectation())
    expect(variance.expectedGrossCents).toBe(CADENCE_GROSS)
    expect(variance.grossVarianceCents).toBe(500_00)
  })

  it('adds the period’s share of the concessional contributions to the expected super', () => {
    const variance = payslipVariance(
      payslip({ salarySacrificeCents: 1_000_00 }),
      // $26,000 a year ÷ 26 = $1,000.00 a fortnight.
      expectation({ annualConcessionalContributionsCents: 26_000_00 }),
    )
    expect(variance.expectedConcessionalCents).toBe(1_000_00)
    expect(variance.expectedSuperCents).toBe(CADENCE_SUPER + 1_000_00)
    expect(variance.actualSuperCents).toBe(CADENCE_SUPER + 1_000_00)
    expect(variance.superVarianceCents).toBe(0)
  })

  it('reports a negative super variance when the employer underpays the guarantee', () => {
    const variance = payslipVariance(payslip({ superCents: 500_00 }), expectation())
    expect(variance.actualSuperCents).toBe(500_00)
    expect(variance.superVarianceCents).toBe(500_00 - CADENCE_SUPER)
  })

  it('counts a null salary sacrifice as nil actual super', () => {
    const variance = payslipVariance(payslip({ salarySacrificeCents: null }), expectation())
    expect(variance.actualSuperCents).toBe(CADENCE_SUPER)
    expect(variance.superVarianceCents).toBe(0)
  })

  it('takes the guarantee rate from the config it is given, never a literal', () => {
    expect(payslipVariance(payslip(), expectation()).expectedSuperGuaranteeCents).toBe(600_00)
    expect(
      payslipVariance(payslip(), expectation({ superConfig: { guaranteeRate: 0.115 } }))
        .expectedSuperGuaranteeCents,
    ).toBe(575_00)
  })

  it('rounds each per-period figure to the nearest cent, halves up, dropping the remainder', () => {
    // $1,000 ÷ 26 = $38.4615… → $38.46. The 26 periods sum to $999.96, four cents
    // short of the annual figure: the remainder is not spread across the year.
    const rounded = payslipVariance(payslip(), expectation({ annualTaxCents: 1_000_00 }))
    expect(rounded.expectedTaxWithheldCents).toBe(38_46)
    expect(26 * rounded.expectedTaxWithheldCents).toBe(999_96)

    // $1,000.09 ÷ 26 = $38.465 exactly, a half rounded up to $38.47.
    expect(
      payslipVariance(payslip(), expectation({ annualTaxCents: 1_000_09 }))
        .expectedTaxWithheldCents,
    ).toBe(38_47)
  })
})

describe('payslipVariance off cadence', () => {
  it('halves every expectation for half a fortnight', () => {
    const variance = payslipVariance(
      payslip({
        periodEnd: '2026-07-07',
        grossCents: 2_500_00,
        taxWithheldCents: 700_00,
        superCents: 300_00,
      }),
      // $26,000 a year of concessional contributions — $1,000 a fortnight, $500 of
      // a half one.
      expectation({ annualConcessionalContributionsCents: 26_000_00 }),
    )
    expect(variance.basis).toBe('part_cycle')
    expect(variance.periodDays).toBe(7)
    expect(variance.cadencePeriodDays).toBe(14)
    // Half of $5,000, half of $1,400, and half of $1,000 — each exactly half,
    // where a 7/365 share of the year would leave all three a few dollars short.
    expect(variance.expectedGrossCents).toBe(CADENCE_GROSS / 2)
    expect(variance.grossVarianceCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD / 2)
    expect(variance.taxWithheldVarianceCents).toBe(0)
    expect(variance.expectedConcessionalCents).toBe(500_00)
  })

  it('measures a straddling period the same whichever year it is filed under', () => {
    // Worked 24 June – 8 July 2027 and paid in July, so filed under FY2028 rather
    // than the FY2027 its first week fell in. All 15 days count either way, and
    // because they are scaled across the fortnight rather than the year the leap
    // year's extra day cannot move the figures at all.
    const straddling = period('2027-06-24', '2027-07-08')
    const paidYear = payslipVariance(payslip({ financialYear: 2028, ...straddling }), expectation())
    expect(paidYear.periodDays).toBe(15)
    expect(paidYear.cadencePeriodDays).toBe(14)
    expect(paidYear.financialYearDays).toBe(366)
    // $5,000 × 15/14 and $1,400 × 15/14.
    expect(paidYear.expectedGrossCents).toBe(5_357_14)
    expect(paidYear.expectedTaxWithheldCents).toBe(1_500_00)

    const earnedYear = payslipVariance(payslip({ financialYear: FY, ...straddling }), expectation())
    expect(earnedYear.financialYearDays).toBe(365)
    expect(earnedYear.expectedGrossCents).toBe(paidYear.expectedGrossCents)
    expect(earnedYear.expectedTaxWithheldCents).toBe(paidYear.expectedTaxWithheldCents)
  })

  it('switches basis between a whole fortnight and one a day short of it', () => {
    const whole = payslipVariance(payslip(), expectation())
    expect(whole.basis).toBe('cadence')
    expect(whole.expectedGrossCents).toBe(CADENCE_GROSS)
    expect(whole.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)

    const partial = payslipVariance(payslip({ periodEnd: '2026-07-13' }), expectation())
    expect(partial.basis).toBe('part_cycle')
    // $5,000 × 13/14 and $1,400 × 13/14 — one day's worth off each, no jump.
    expect(partial.expectedGrossCents).toBe(4_642_86)
    expect(partial.expectedTaxWithheldCents).toBe(1_300_00)
  })

  it('switches basis at the shortest and longest calendar month', () => {
    const forPeriod = (periodStart: string, periodEnd: string) =>
      payslipVariance(
        payslip({ ...period(periodStart, periodEnd), grossCents: 10_000_00 }),
        expectation({ inflowsById: inflowsById(MONTHLY) }),
      )

    // 28 days is February, a whole month; 27 days is no month at all.
    expect(forPeriod('2027-02-01', '2027-02-28').basis).toBe('cadence')
    const short = forPeriod('2026-07-01', '2026-07-27')
    expect(short.basis).toBe('part_cycle')
    expect(short.cadencePeriodDays).toBe(31)
    // $10,000 × 27/31.
    expect(short.expectedGrossCents).toBe(8_709_68)

    // 31 days is the longest month; 32 is longer than any.
    expect(forPeriod('2026-07-01', '2026-07-31').basis).toBe('cadence')
    const long = forPeriod('2026-07-01', '2026-08-01')
    expect(long.basis).toBe('part_cycle')
    // $10,000 × 32/31 — a day of July's pay over a whole month's.
    expect(long.expectedGrossCents).toBe(10_322_58)
  })

  it('expects exactly a twelfth of the year of a whole month, however long it runs', () => {
    const forPeriod = (periodStart: string, periodEnd: string) =>
      payslipVariance(
        payslip({ ...period(periodStart, periodEnd), grossCents: 10_000_00 }),
        expectation({ inflowsById: inflowsById(MONTHLY) }),
      )
    // $120,000 ÷ 12 for July's 31 days and February's 28 alike, and half of it for
    // half of either — a shade under half in a long month, exactly half in a short.
    expect(forPeriod('2026-07-01', '2026-07-31').expectedGrossCents).toBe(10_000_00)
    expect(forPeriod('2027-02-01', '2027-02-28').expectedGrossCents).toBe(10_000_00)
    expect(forPeriod('2026-07-01', '2026-07-15').expectedGrossCents).toBe(4_838_71)
    expect(forPeriod('2027-02-01', '2027-02-14').expectedGrossCents).toBe(5_000_00)
  })

  it('apportions over the financial year when the cadence states no interval', () => {
    // The only case left with no pay cycle to scale across, so the year's own days
    // decide the withholding — the gross annualises to nothing regardless.
    const variance = payslipVariance(
      payslip({ periodEnd: '2026-07-07' }),
      expectation({ inflowsById: inflowsById(NO_INTERVAL) }),
    )
    expect(variance.cadenceInflowId).toBe('salary')
    expect(variance.basis).toBe('calendar_days')
    expect(variance.partCycleReason).toBeNull()
    expect(variance.cadencePeriodDays).toBeNull()
    // $36,400 × 7/365.
    expect(variance.expectedTaxWithheldCents).toBe(698_08)
  })

  it('expects no gross for a payslip whose lines name no inflow', () => {
    const unmapped = payslipVariance(
      payslip({
        lines: [{ kind: 'earning', sourceInflowId: null, label: 'Bonus', amountCents: 0 }],
      }),
      expectation(),
    )
    expect(unmapped.expectedGrossCents).toBeNull()
    expect(unmapped.grossVarianceCents).toBeNull()
    // With no projection named there is no cadence to read, so the member-level
    // expectations fall to calendar days: withholding from their annual estimated
    // tax, and the guarantee from the slip's own gross.
    expect(unmapped.cadenceInflowId).toBeNull()
    expect(unmapped.basis).toBe('calendar_days')
    expect(unmapped.partCycleReason).toBeNull()
    expect(unmapped.expectedTaxWithheldCents).toBe(DAY_PRORATED_WITHHELD)
    expect(unmapped.expectedSuperCents).toBe(CADENCE_SUPER)

    // An expectation carrying no inflows at all reads the same way, since a line
    // naming one it does not hold resolves to nothing either.
    const absent = payslipVariance(payslip(), {
      annualTaxCents: ANNUAL_TAX,
      superConfig: SUPER_CONFIG,
    })
    expect(absent.expectedGrossCents).toBeNull()
    expect(absent.grossVarianceCents).toBeNull()
    expect(absent.cadenceInflowId).toBeNull()
    expect(absent.basis).toBe('calendar_days')
  })

  it('scales the gross by the days the inflow’s effective dates leave', () => {
    // The salary starts mid-period, so half a fortnight of it was earned — but the
    // fortnight the employer withheld on is whole, so the withholding expectation
    // is a whole period's.
    const variance = payslipVariance(
      payslip({ grossCents: 2_500_00 }),
      expectation({ inflowsById: inflowsById({ ...SALARY, startsOn: '2026-07-08' }) }),
    )
    expect(variance.basis).toBe('part_cycle')
    expect(variance.expectedGrossCents).toBe(2_500_00)
    expect(variance.grossVarianceCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)
  })

  it('expects nothing of a period ending before it starts', () => {
    const variance = payslipVariance(
      payslip({ ...period('2026-07-14', '2026-07-01') }),
      expectation(),
    )
    expect(variance.basis).toBe('part_cycle')
    expect(variance.periodDays).toBe(0)
    expect(variance.expectedGrossCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBe(0)
  })
})

describe('payslipVariance part-cycle reasons', () => {
  /** The fortnight a pay rise falls in: 11–24 July 2026, a whole turn of the cycle. */
  const RISE_FORTNIGHT = period('2026-07-11', '2026-07-24')

  /** The rate being left behind, effective to 22 July — 12 of the fortnight's 14 days. */
  const OLD_RATE: ReconciledInflow = { ...SALARY, endsOn: '2026-07-22' }

  /** The rate taking over from 23 July, at $5,200 a fortnight — the other 2 days. */
  const NEW_RATE: ReconciledInflow = { ...SALARY, amountCents: 5_200_00, startsOn: '2026-07-23' }

  /** $130,000 × 12/14 ÷ 26 — the old rate's share of the fortnight it ends in. */
  const OLD_RATE_SHARE = 4_285_71

  /** $135,200 × 2/14 ÷ 26 — the new rate's share of the fortnight it starts in. */
  const NEW_RATE_SHARE = 742_86

  /** The pay rise as the household models it: the old rate ending, a new one starting. */
  function riseExpectation(newRate: ReconciledInflow = NEW_RATE): PayslipExpectation {
    return expectation({
      inflowsById: new Map([
        ['salary', OLD_RATE],
        ['salary-risen', newRate],
      ]),
    })
  }

  /** The fortnight's slip, itemised as one line per rate it was paid at. */
  function riseSlip(oldCents: Money, newCents: Money): PayslipActuals {
    return payslip({
      ...RISE_FORTNIGHT,
      grossCents: oldCents + newCents,
      lines: [
        salaryLine(oldCents),
        {
          kind: 'earning',
          sourceInflowId: 'salary-risen',
          label: 'Ordinary Hours (new rate)',
          amountCents: newCents,
        },
      ],
    })
  }

  it('names the period where it is not one whole turn of the cycle', () => {
    const variance = payslipVariance(payslip({ periodEnd: '2026-07-13' }), expectation())
    expect(variance.basis).toBe('part_cycle')
    expect(variance.partCycleReason).toBe('part_period')
    expect(variance.lineGroups[0]?.partCycleReason).toBe('part_period')
  })

  it('names the inflow’s dates where a whole period’s inflow starts partway through', () => {
    const variance = payslipVariance(
      payslip({ grossCents: 2_500_00 }),
      expectation({ inflowsById: inflowsById({ ...SALARY, startsOn: '2026-07-08' }) }),
    )
    expect(variance.periodDays).toBe(14)
    expect(variance.cadencePeriodDays).toBe(14)
    expect(variance.basis).toBe('part_cycle')
    expect(variance.partCycleReason).toBe('inflow_dates')
    expect(variance.lineGroups[0]?.partCycleReason).toBe('inflow_dates')
  })

  it('names the inflow’s dates where a whole period’s inflow ends partway through', () => {
    const variance = payslipVariance(
      payslip({ grossCents: 2_500_00 }),
      expectation({ inflowsById: inflowsById({ ...SALARY, endsOn: '2026-07-07' }) }),
    )
    expect(variance.basis).toBe('part_cycle')
    expect(variance.partCycleReason).toBe('inflow_dates')
    expect(variance.lineGroups[0]?.partCycleReason).toBe('inflow_dates')
  })

  it('names the inflow’s dates for both sides of a pay rise mid-fortnight', () => {
    // The household's real shape: a $130,000 wage ending 22 July and a $135,200 one
    // starting 23 July, over the whole fortnight 11–24 July. Neither rate covers all
    // 14 days, so neither group is on cadence — but the fortnight itself is a whole
    // turn, and it is the rate that changed rather than the period being short.
    const variance = payslipVariance(riseSlip(OLD_RATE_SHARE, NEW_RATE_SHARE), riseExpectation())
    expect(variance.periodDays).toBe(14)
    expect(variance.cadencePeriodDays).toBe(14)
    expect(variance.lineGroups.map((group) => group.partCycleReason)).toEqual([
      'inflow_dates',
      'inflow_dates',
    ])
    // The slip's own basis is read from the largest group — the old rate, which paid
    // 12 of the 14 days — and reports the same reason.
    expect(variance.cadenceInflowId).toBe('salary')
    expect(variance.basis).toBe('part_cycle')
    expect(variance.partCycleReason).toBe('inflow_dates')

    // Nothing is approximated. 12/14 of $5,000 plus 2/14 of $5,200 is the fortnight
    // at the blended rate, which is exactly what the slip paid, and the withholding
    // expectation is a whole fortnight's rather than a share of one.
    expect(variance.lineGroups.map((group) => group.expectedCents)).toEqual([
      OLD_RATE_SHARE,
      NEW_RATE_SHARE,
    ])
    expect(variance.expectedGrossCents).toBe(5_028_57)
    expect(variance.grossVarianceCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)
  })

  it('has the two shares of an unchanged rate sum to one whole period’s pay', () => {
    // Same $130,000 either side of the split, so the two shares have to come to the
    // fortnight's whole $5,000 — a variance against either is real pay off plan
    // rather than the split losing anything.
    const groups = payslipVariance(
      riseSlip(OLD_RATE_SHARE, 71_429),
      riseExpectation({ ...SALARY, startsOn: '2026-07-23' }),
    ).lineGroups
    expect(groups.map((group) => group.expectedCents)).toEqual([OLD_RATE_SHARE, 71_429])
    expect((groups[0]?.expectedCents ?? 0) + (groups[1]?.expectedCents ?? 0)).toBe(CADENCE_GROSS)
  })

  it('keeps the period’s own reason where a part period’s inflow is dated too', () => {
    // A week of a fortnightly cycle, and the rate changes inside even that. The
    // figures are a fraction of a period's pay however the days were clipped, which
    // is the period's fault and reads as such.
    const variance = payslipVariance(
      payslip({ periodEnd: '2026-07-07', grossCents: 1_250_00 }),
      expectation({ inflowsById: inflowsById({ ...SALARY, startsOn: '2026-07-04' }) }),
    )
    expect(variance.basis).toBe('part_cycle')
    expect(variance.partCycleReason).toBe('part_period')
  })

  it('reports no reason for a slip on the cadence of the cycle that paid it', () => {
    const variance = payslipVariance(payslip(), expectation())
    expect(variance.basis).toBe('cadence')
    expect(variance.partCycleReason).toBeNull()
    expect(variance.lineGroups[0]?.partCycleReason).toBeNull()
  })

  it('reports no reason where there is no pay cycle to be part of', () => {
    const noInterval = payslipVariance(
      payslip({ periodEnd: '2026-07-07' }),
      expectation({ inflowsById: inflowsById(NO_INTERVAL) }),
    )
    expect(noInterval.basis).toBe('calendar_days')
    expect(noInterval.partCycleReason).toBeNull()
    expect(noInterval.lineGroups[0]?.partCycleReason).toBeNull()

    const unmapped = payslipVariance(
      payslip({
        periodEnd: '2026-07-07',
        lines: [{ kind: 'earning', sourceInflowId: null, label: 'Bonus', amountCents: 2_500_00 }],
      }),
      expectation(),
    )
    expect(unmapped.basis).toBe('calendar_days')
    expect(unmapped.partCycleReason).toBeNull()
    expect(unmapped.lineGroups[0]?.partCycleReason).toBeNull()
  })
})

describe('payslipYearToDate', () => {
  it('sums the actuals across a member’s payslips', () => {
    expect(
      payslipYearToDate([
        row({ salarySacrificeCents: 100_00 }),
        row({ periodEnd: '2026-07-28', taxWithheldCents: 1_450_00 }),
        row({
          periodEnd: '2026-08-11',
          grossCents: 5_200_00,
          taxWithheldCents: 1_500_00,
          superCents: 624_00,
          salarySacrificeCents: null,
        }),
      ]),
    ).toEqual({
      grossCents: 15_200_00,
      taxWithheldCents: 4_350_00,
      superCents: 1_824_00,
      salarySacrificeCents: 100_00,
      payslipCount: 3,
    })
  })

  it('sums a financial year with no payslips to nil', () => {
    expect(payslipYearToDate([])).toEqual({
      grossCents: 0,
      taxWithheldCents: 0,
      superCents: 0,
      salarySacrificeCents: 0,
      payslipCount: 0,
    })
  })
})

describe('payslipYearToDateByMember', () => {
  it('sums each member’s payslips separately', () => {
    const totals = payslipYearToDateByMember([
      row(),
      row({ periodEnd: '2026-07-28' }),
      row({
        memberId: 'blair',
        grossCents: 3_000_00,
        taxWithheldCents: 500_00,
        superCents: 360_00,
      }),
    ])
    expect(totals.get('alex')).toEqual({
      grossCents: 10_000_00,
      taxWithheldCents: 2_800_00,
      superCents: 1_200_00,
      salarySacrificeCents: 0,
      payslipCount: 2,
    })
    expect(totals.get('blair')?.taxWithheldCents).toBe(500_00)
  })

  it('holds no entry for a member with no payslips', () => {
    expect(payslipYearToDateByMember([]).size).toBe(0)
  })
})

describe('paygWithheldByMember', () => {
  it('keys each member’s summed actual withholding by member id', () => {
    const withheld = paygWithheldByMember([
      row(),
      row({ periodEnd: '2026-07-28', taxWithheldCents: 1_450_00 }),
      row({ memberId: 'blair', taxWithheldCents: 500_00 }),
    ])
    expect([...withheld]).toEqual([
      ['alex', 2_850_00],
      ['blair', 500_00],
    ])
  })

  it('is empty for a financial year with no payslips', () => {
    expect(paygWithheldByMember([]).size).toBe(0)
  })
})

describe('latestReportedYearToDate', () => {
  it('takes the running totals from the latest reporting payslip', () => {
    expect(
      latestReportedYearToDate([
        row({
          periodEnd: '2026-07-28',
          ytdGrossCents: 10_000_00,
          ytdTaxWithheldCents: 2_850_00,
          ytdSuperCents: 1_200_00,
        }),
        row({ ytdGrossCents: 5_000_00, ytdTaxWithheldCents: 1_400_00, ytdSuperCents: 600_00 }),
      ]),
    ).toEqual({ grossCents: 10_000_00, taxWithheldCents: 2_850_00, superCents: 1_200_00 })
  })

  it('skips payslips missing any of the three running totals', () => {
    expect(
      latestReportedYearToDate([
        row({ ytdGrossCents: 5_000_00, ytdTaxWithheldCents: 1_400_00, ytdSuperCents: 600_00 }),
        row({
          periodEnd: '2026-08-11',
          ytdGrossCents: null,
          ytdTaxWithheldCents: 4_250_00,
          ytdSuperCents: 1_800_00,
        }),
        row({
          periodEnd: '2026-08-25',
          ytdGrossCents: 20_000_00,
          ytdTaxWithheldCents: null,
          ytdSuperCents: 2_400_00,
        }),
        row({ periodEnd: '2026-09-08', ytdGrossCents: 25_000_00, ytdTaxWithheldCents: 7_000_00 }),
      ]),
    ).toEqual({ grossCents: 5_000_00, taxWithheldCents: 1_400_00, superCents: 600_00 })
  })

  it('reports nothing when no payslip carries running totals', () => {
    expect(latestReportedYearToDate([row(), row({ periodEnd: '2026-07-28' })])).toBeNull()
    expect(latestReportedYearToDate([])).toBeNull()
  })

  it('ranks by the date the pay landed, not by the period it covered', () => {
    // Back-pay for a September period, paid after the regular October slip: the
    // employer's running totals include it, so its figures are the later ones.
    expect(
      latestReportedYearToDate([
        row({
          periodEnd: '2026-10-13',
          paidOn: '2026-10-15',
          ytdGrossCents: 40_000_00,
          ytdTaxWithheldCents: 11_200_00,
          ytdSuperCents: 4_800_00,
        }),
        row({
          periodEnd: '2026-09-15',
          paidOn: '2026-10-29',
          ytdGrossCents: 42_500_00,
          ytdTaxWithheldCents: 12_000_00,
          ytdSuperCents: 5_100_00,
        }),
      ]),
    ).toEqual({ grossCents: 42_500_00, taxWithheldCents: 12_000_00, superCents: 5_100_00 })
  })

  it('ranks a slip stating no payment date by its period end', () => {
    expect(
      latestReportedYearToDate([
        row({
          periodEnd: '2026-07-28',
          ytdGrossCents: 10_000_00,
          ytdTaxWithheldCents: 2_800_00,
          ytdSuperCents: 1_200_00,
        }),
        row({
          periodEnd: '2026-07-14',
          paidOn: '2026-07-16',
          ytdGrossCents: 5_000_00,
          ytdTaxWithheldCents: 1_400_00,
          ytdSuperCents: 600_00,
        }),
      ]),
    ).toEqual({ grossCents: 10_000_00, taxWithheldCents: 2_800_00, superCents: 1_200_00 })
  })
})

/**
 * The real slip this grouping exists for: one Heidi Health fortnight of a
 * $130,000 salary, split across ordinary hours and annual leave, plus a
 * $495.50 on-call allowance that is taxed in full but earns no super.
 */
const HEIDI_PERIOD = period('2026-06-27', '2026-07-10')

/** The on-call allowance, projected at $450 a fortnight and outside the super base. */
const ON_CALL: ReconciledInflow = {
  type: 'other',
  schedule: 'fortnightly',
  amountCents: 450_00,
  attractsSuper: false,
}

/** The projections a Heidi slip's lines draw on, keyed as the expectation reads them. */
const HEIDI_INFLOWS = new Map<string, ReconciledInflow>([
  ['salary', SALARY],
  ['on-call', ON_CALL],
])

/**
 * The slip's three earnings lines: two on the salary, one on the allowance, each
 * carrying the ordinary-time-earnings decision recorded when it was written.
 */
const HEIDI_LINES: readonly PayslipEarningLine[] = [
  { kind: 'earning', sourceInflowId: 'salary', label: 'Ordinary Hours', amountCents: 4_000_00 },
  { kind: 'earning', sourceInflowId: 'salary', label: 'Annual Leave', amountCents: 1_000_00 },
  {
    kind: 'earning',
    sourceInflowId: 'on-call',
    label: 'On-call (T1)',
    amountCents: 495_50,
    attractsSuper: false,
  },
]

/** The same slip's TAX section: PAYG $1,416.00 and STSL $434.00 over a $1,850.00 total. */
const HEIDI_TAX_LINES: readonly PayslipTaxLine[] = [
  { kind: 'tax', component: 'payg', label: 'PAYG', amountCents: 1_416_00 },
  { kind: 'tax', component: 'stsl', label: 'STSL Component', amountCents: 434_00 },
]

/** That slip's actuals: $5,495.50 gross, $1,850 tax, $600 super. */
function heidiPayslip(overrides: Partial<PayslipActuals> = {}): PayslipActuals {
  return payslip({
    ...HEIDI_PERIOD,
    grossCents: 5_495_50,
    taxWithheldCents: 1_850_00,
    superCents: 600_00,
    lines: HEIDI_LINES,
    ...overrides,
  })
}

/** That slip's expectation: both the inflows its lines draw on, resolvable. */
function heidiExpectation(overrides: Partial<PayslipExpectation> = {}): PayslipExpectation {
  return expectation({ inflowsById: HEIDI_INFLOWS, ...overrides })
}

describe('payslipVariance with earnings lines', () => {
  it('sums the lines drawing on one inflow into a single group in slip order', () => {
    expect(payslipVariance(heidiPayslip(), heidiExpectation()).lineGroups).toEqual([
      {
        sourceInflowId: 'salary',
        labels: ['Ordinary Hours', 'Annual Leave'],
        actualCents: 5_000_00,
        // $130,000 ÷ 26 exactly, so the two salary lines land dead on plan.
        expectedCents: 5_000_00,
        varianceCents: 0,
        basis: 'cadence',
        partCycleReason: null,
      },
      {
        sourceInflowId: 'on-call',
        labels: ['On-call (T1)'],
        actualCents: 495_50,
        expectedCents: 450_00,
        varianceCents: 45_50,
        basis: 'cadence',
        partCycleReason: null,
      },
    ])
  })

  it('keeps the allowance’s lumpiness out of the salary’s variance', () => {
    const [salary, onCall] = payslipVariance(heidiPayslip(), heidiExpectation()).lineGroups
    expect(salary?.varianceCents).toBe(0)
    expect(onCall?.varianceCents).toBe(45_50)
  })

  // The employer pays 12% of the $5,000 salary, not of the $5,495.50 gross:
  // 12% of the whole gross expects $659.46 and reads a correct slip as $59.46
  // below plan.
  it('charges the expected super guarantee on the gross less the non-OTE lines', () => {
    const variance = payslipVariance(heidiPayslip(), heidiExpectation())
    expect(variance.superBaseCents).toBe(5_000_00)
    expect(variance.expectedSuperGuaranteeCents).toBe(600_00)
    expect(variance.expectedSuperGuaranteeCents).not.toBe(659_46)
    expect(variance.superVarianceCents).toBe(0)
  })

  it('counts a line that says nothing about super toward the super base', () => {
    const variance = payslipVariance(
      heidiPayslip({
        lines: HEIDI_LINES.map(({ sourceInflowId, label, amountCents }) => ({
          kind: 'earning' as const,
          sourceInflowId,
          label,
          amountCents,
        })),
      }),
      heidiExpectation(),
    )
    expect(variance.superBaseCents).toBe(5_495_50)
  })

  it('never charges the guarantee on a base below nil', () => {
    // A mistyped allowance overshooting the gross would otherwise expect
    // negative super and read the slip as far above plan.
    const variance = payslipVariance(
      heidiPayslip({
        grossCents: 495_50,
        lines: [
          {
            kind: 'earning',
            sourceInflowId: 'on-call',
            label: 'On-call',
            amountCents: 4_955_00,
            attractsSuper: false,
          },
        ],
      }),
      heidiExpectation(),
    )
    expect(variance.superBaseCents).toBe(0)
    expect(variance.expectedSuperGuaranteeCents).toBe(0)
  })

  it('sums the group expectations into the slip’s expected gross', () => {
    const variance = payslipVariance(heidiPayslip(), heidiExpectation())
    expect(variance.expectedGrossCents).toBe(5_450_00)
    expect(variance.grossVarianceCents).toBe(45_50)
  })

  it('reports the gross the lines do not account for', () => {
    const variance = payslipVariance(heidiPayslip({ grossCents: 5_600_00 }), heidiExpectation())
    expect(variance.unallocatedCents).toBe(104_50)
  })

  it('reports lines overshooting the gross as a negative remainder', () => {
    const variance = payslipVariance(heidiPayslip({ grossCents: 5_000_00 }), heidiExpectation())
    expect(variance.unallocatedCents).toBe(-495_50)
  })

  it('leaves a line mapped to no inflow with nothing to compare', () => {
    const variance = payslipVariance(
      heidiPayslip({
        lines: [
          salaryLine(5_000_00),
          { kind: 'earning', sourceInflowId: null, label: 'Bonus', amountCents: 495_50 },
        ],
      }),
      heidiExpectation(),
    )
    expect(variance.lineGroups[1]).toEqual({
      sourceInflowId: null,
      labels: ['Bonus'],
      actualCents: 495_50,
      expectedCents: null,
      varianceCents: null,
      basis: 'calendar_days',
      partCycleReason: null,
    })
    // The bonus is real earnings the plan never projected, so it reads as gross
    // above plan rather than vanishing from the comparison.
    expect(variance.expectedGrossCents).toBe(5_000_00)
    expect(variance.grossVarianceCents).toBe(495_50)
  })

  it('treats a line naming a retired inflow as mapped to none', () => {
    const variance = payslipVariance(
      heidiPayslip(),
      heidiExpectation({ inflowsById: new Map([['salary', SALARY]]) }),
    )
    expect(variance.lineGroups[1]?.expectedCents).toBeNull()
    // The line's own record of earning no super stands whatever became of the
    // inflow, so a retired allowance cannot re-inflate a past slip's super base.
    expect(variance.superBaseCents).toBe(5_000_00)
    expect(variance.expectedSuperGuaranteeCents).toBe(600_00)
  })

  it('has no gross expectation when nothing on the slip maps to a projection', () => {
    const variance = payslipVariance(
      heidiPayslip({
        lines: [{ kind: 'earning', sourceInflowId: null, label: 'Bonus', amountCents: 5_495_50 }],
      }),
      heidiExpectation(),
    )
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.grossVarianceCents).toBeNull()
  })

  it('scales a group across its cadence when the period is not one turn of it', () => {
    const group = payslipVariance(
      heidiPayslip({ ...period('2026-06-27', '2026-07-03') }),
      heidiExpectation(),
    ).lineGroups[0]
    expect(group?.basis).toBe('part_cycle')
    // Half a fortnight of the $5,000 salary, the same share a whole part-period
    // slip gets.
    expect(group?.expectedCents).toBe(2_500_00)
  })

  it('reads the withholding basis from the largest group’s cadence', () => {
    // The salary makes up most of the payment, so its fortnightly cadence is the
    // cycle the withholding is divided by — not the allowance's.
    const variance = payslipVariance(heidiPayslip(), heidiExpectation())
    expect(variance.cadenceInflowId).toBe('salary')
    expect(variance.basis).toBe('cadence')
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)
  })

  it('measures a slip with no lines against nothing, on calendar days', () => {
    // Nothing on it names a projection, so there is no gross to expect and no
    // cycle to read; the printed totals are still held against the year's own
    // figures, apportioned by the days the period covers.
    const variance = payslipVariance(payslip({ lines: [] }), heidiExpectation())
    expect(variance.lineGroups).toEqual([])
    expect(variance.taxGroups).toEqual([])
    expect(variance.unallocatedCents).toBe(0)
    expect(variance.unallocatedTaxCents).toBe(0)
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.grossVarianceCents).toBeNull()
    expect(variance.cadenceInflowId).toBeNull()
    expect(variance.basis).toBe('calendar_days')
    expect(variance.expectedTaxWithheldCents).toBe(DAY_PRORATED_WITHHELD)
    // Nothing on the slip says any of its gross is other than ordinary time
    // earnings, so the guarantee is charged on all of it.
    expect(variance.superBaseCents).toBe(CADENCE_GROSS)
    expect(variance.expectedSuperGuaranteeCents).toBe(CADENCE_SUPER)

    // A slip stating no lines at all — an aggregation reading only the row's own
    // figures — reads exactly as an empty set of them.
    expect(
      payslipVariance(
        {
          financialYear: FY,
          ...FORTNIGHT,
          grossCents: CADENCE_GROSS,
          taxWithheldCents: CADENCE_WITHHELD,
          superCents: CADENCE_SUPER,
        },
        heidiExpectation(),
      ),
    ).toEqual(variance)
  })
})

describe('payslipVariance cadence derivation', () => {
  /** A fortnightly $2,000 bonus-shaped inflow, and an annual $26,000 one. */
  const SECOND_FORTNIGHTLY: ReconciledInflow = {
    type: 'other',
    schedule: 'fortnightly',
    amountCents: 2_000_00,
  }
  const ANNUAL_BONUS: ReconciledInflow = {
    type: 'other',
    schedule: 'annual',
    amountCents: 26_000_00,
  }

  /** A slip of two earnings lines, the second drawing on `second`. */
  function twoLineSlip(firstCents: Money, secondCents: Money): PayslipActuals {
    return payslip({
      grossCents: firstCents + secondCents,
      lines: [
        salaryLine(firstCents),
        { kind: 'earning', sourceInflowId: 'second', label: 'Other', amountCents: secondCents },
      ],
    })
  }

  /** Both inflows, keyed as those two lines name them. */
  function twoInflows(second: ReconciledInflow): ReadonlyMap<string, ReconciledInflow> {
    return new Map([
      ['salary', SALARY],
      ['second', second],
    ])
  }

  it('reads the cadence from the largest earnings group, whichever line came first', () => {
    // The smaller line is printed first, and the larger group still decides.
    const variance = payslipVariance(
      payslip({
        grossCents: 5_500_00,
        lines: [
          { kind: 'earning', sourceInflowId: 'second', label: 'Other', amountCents: 500_00 },
          salaryLine(5_000_00),
        ],
      }),
      expectation({ inflowsById: twoInflows(SECOND_FORTNIGHTLY) }),
    )
    expect(variance.cadenceInflowId).toBe('salary')
  })

  it('keeps the group the slip printed first when two are equal', () => {
    const variance = payslipVariance(
      twoLineSlip(2_500_00, 2_500_00),
      expectation({ inflowsById: twoInflows(SECOND_FORTNIGHTLY) }),
    )
    expect(variance.cadenceInflowId).toBe('salary')
  })

  it('takes the largest group’s cadence even where the groups disagree', () => {
    // An annual bonus paid beside the fortnightly salary: the fortnight is still a
    // whole turn of the cycle that paid most of it, so the withholding is still
    // divided by 26 rather than apportioned across a bonus's year.
    const variance = payslipVariance(
      twoLineSlip(5_000_00, 1_000_00),
      expectation({ inflowsById: twoInflows(ANNUAL_BONUS) }),
    )
    expect(variance.cadenceInflowId).toBe('salary')
    expect(variance.basis).toBe('cadence')
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)
  })

  it('scales across the largest group’s cadence when the period does not fit it', () => {
    // The bonus is the bulk of this payment, so its annual cadence is what the
    // slip reads — and a fortnight is no turn of a year, which is what makes the
    // pick self-correcting rather than wrong. A turn of an annual cadence from
    // 1 July is the financial year itself, so the fortnight reads as 14/365 of the
    // year's withholding.
    const variance = payslipVariance(
      twoLineSlip(1_000_00, 20_000_00),
      expectation({ inflowsById: twoInflows(ANNUAL_BONUS) }),
    )
    expect(variance.cadenceInflowId).toBe('second')
    expect(variance.basis).toBe('part_cycle')
    expect(variance.cadencePeriodDays).toBe(365)
    expect(variance.expectedTaxWithheldCents).toBe(DAY_PRORATED_WITHHELD)
  })

  it('reads no cadence from a group naming an inflow the expectation has lost', () => {
    // Every line draws on an inflow since retired, so there is nothing to read a
    // cycle from — and nothing to expect a gross from either.
    const variance = payslipVariance(payslip(), expectation({ inflowsById: new Map() }))
    expect(variance.cadenceInflowId).toBeNull()
    expect(variance.basis).toBe('calendar_days')
    expect(variance.expectedGrossCents).toBeNull()
  })

  it('ignores tax lines when reading the cadence', () => {
    // Tax is withheld from earnings, not earned, so a tax line larger than every
    // earnings line does not become the slip's pay cycle.
    const variance = payslipVariance(
      payslip({
        grossCents: 5_000_00,
        taxWithheldCents: 1_850_00,
        lines: [salaryLine(5_000_00), ...HEIDI_TAX_LINES],
      }),
      expectation(),
    )
    expect(variance.cadenceInflowId).toBe('salary')
    expect(variance.basis).toBe('cadence')
  })
})

/**
 * The estimate behind the same real slip: a $48,100 liability for the year, of
 * which $11,284 is the compulsory HELP repayment the STSL component pays. Over 26
 * fortnights that is $1,850.00 withheld a period — $1,416.00 of PAYG and $434.00
 * of STSL, exactly what the slip prints.
 */
const ANNUAL_LIABILITY = 48_100_00
const ANNUAL_HELP = 11_284_00
const CADENCE_PAYG = 1_416_00
const CADENCE_STSL = 434_00

/** That slip, with its TAX section itemised, against that estimate. */
function taxItemisedVariance(
  taxLines: readonly PayslipTaxLine[] = HEIDI_TAX_LINES,
  overrides: Partial<PayslipActuals> = {},
) {
  return payslipVariance(
    heidiPayslip({ lines: [...HEIDI_LINES, ...taxLines], ...overrides }),
    heidiExpectation({
      annualTaxCents: ANNUAL_LIABILITY,
      annualHelpRepaymentCents: ANNUAL_HELP,
    }),
  )
}

describe('payslipVariance with tax lines', () => {
  it('measures each component against the part of the liability it pays', () => {
    expect(taxItemisedVariance().taxGroups).toEqual([
      {
        component: 'payg',
        labels: ['PAYG'],
        actualCents: CADENCE_PAYG,
        expectedCents: CADENCE_PAYG,
        varianceCents: 0,
      },
      {
        component: 'stsl',
        labels: ['STSL Component'],
        actualCents: CADENCE_STSL,
        expectedCents: CADENCE_STSL,
        varianceCents: 0,
      },
    ])
  })

  it('isolates a study-loan component that is short from income tax that is over', () => {
    // The printed total is right to the cent, so measuring the slip's tax as one
    // lump reads it as perfectly on plan. Per component, $84 of the study loan was
    // never withheld and $84 too much income tax was.
    const variance = taxItemisedVariance([
      { kind: 'tax', component: 'payg', label: 'PAYG', amountCents: 1_500_00 },
      { kind: 'tax', component: 'stsl', label: 'STSL Component', amountCents: 350_00 },
    ])
    expect(variance.taxWithheldVarianceCents).toBe(0)
    expect(variance.taxGroups.map((group) => group.varianceCents)).toEqual([84_00, -84_00])
  })

  it('sums several lines paying one component into a single group in slip order', () => {
    const variance = taxItemisedVariance([
      { kind: 'tax', component: 'payg', label: 'PAYG', amountCents: 1_400_00 },
      { kind: 'tax', component: 'stsl', label: 'STSL Component', amountCents: 434_00 },
      { kind: 'tax', component: 'payg', label: 'PAYG adjustment', amountCents: 16_00 },
    ])
    expect(variance.taxGroups[0]).toEqual({
      component: 'payg',
      labels: ['PAYG', 'PAYG adjustment'],
      actualCents: CADENCE_PAYG,
      expectedCents: CADENCE_PAYG,
      varianceCents: 0,
    })
    expect(variance.taxGroups[1]?.labels).toEqual(['STSL Component'])
  })

  it('reports the withheld tax the lines do not account for', () => {
    expect(
      taxItemisedVariance(HEIDI_TAX_LINES, { taxWithheldCents: 1_900_00 }).unallocatedTaxCents,
    ).toBe(50_00)
    expect(
      taxItemisedVariance(HEIDI_TAX_LINES, { taxWithheldCents: 1_800_00 }).unallocatedTaxCents,
    ).toBe(-50_00)
    expect(taxItemisedVariance().unallocatedTaxCents).toBe(0)
    // A slip that itemises only its earnings has no tax remainder to report.
    expect(taxItemisedVariance([]).unallocatedTaxCents).toBe(0)
  })

  it('holds a PAYG line against the whole liability for a member with no study loan', () => {
    // No HELP debt means no compulsory repayment inside the liability, so every
    // dollar of it is what the PAYG line is expected to pay.
    const variance = payslipVariance(
      heidiPayslip({ lines: [...HEIDI_LINES, HEIDI_TAX_LINES[0]!] }),
      heidiExpectation({ annualTaxCents: ANNUAL_LIABILITY }),
    )
    expect(variance.taxGroups).toEqual([
      {
        component: 'payg',
        labels: ['PAYG'],
        actualCents: CADENCE_PAYG,
        expectedCents: 1_850_00,
        varianceCents: CADENCE_PAYG - 1_850_00,
      },
    ])
  })

  it('halves each component for half a turn of the pay cycle', () => {
    // Half the fortnight, each component scaled on the same basis as the slip's own
    // withholding expectation — so each is exactly half its whole-period figure.
    const variance = taxItemisedVariance(HEIDI_TAX_LINES, {
      ...period('2026-06-27', '2026-07-03'),
    })
    expect(variance.basis).toBe('part_cycle')
    expect(variance.taxGroups[0]?.expectedCents).toBe(CADENCE_PAYG / 2)
    expect(variance.taxGroups[1]?.expectedCents).toBe(CADENCE_STSL / 2)
  })

  it('keeps the year’s withheld total the printed total, every component included', () => {
    // The estimate nets one withheld figure against a liability that already
    // carries the HELP repayment, so the year counts the whole of each slip's tax
    // — never the PAYG lines alone, which would understate it by every dollar of
    // STSL withheld.
    const slip = taxItemisedVariance()
    const linedTotal = slip.taxGroups.reduce((sum, group) => sum + group.actualCents, 0)
    expect(linedTotal).toBe(1_850_00)

    const withheld = paygWithheldByMember([
      row({ taxWithheldCents: 1_850_00 }),
      row({ periodEnd: '2026-07-24', taxWithheldCents: 1_850_00 }),
    ])
    expect(withheld.get('alex')).toBe(2 * linedTotal)
    expect(withheld.get('alex')).not.toBe(2 * CADENCE_PAYG)
  })
})

/**
 * The shape this whole flag exists for: the household's fortnightly salary beside
 * two on-call allowances paid on the same payrun, but only for the fortnights a
 * shift was actually worked. Each is projected as an annual figure — what the year
 * is expected to bring — arriving on the fortnightly cycle, taxed in full and
 * earning no super.
 */
const ON_CALL_T1: ReconciledInflow = {
  type: 'other',
  schedule: 'annual',
  amountCents: 6_600_00,
  paySchedule: 'fortnightly',
  arrivesEveryPayPeriod: false,
  attractsSuper: false,
}

/** The second on-call tier, projected at $2,600 a year on the same cycle. */
const ON_CALL_T2: ReconciledInflow = { ...ON_CALL_T1, amountCents: 2_600_00 }

/** The household's three taxable inflows, keyed as its slips' lines name them. */
const ON_CALL_INFLOWS = new Map<string, ReconciledInflow>([
  ['salary', SALARY],
  ['t1', ON_CALL_T1],
  ['t2', ON_CALL_T2],
])

/** The same three, with both allowances claiming to arrive every fortnight. */
const EVERY_PERIOD_INFLOWS = new Map<string, ReconciledInflow>([
  ['salary', SALARY],
  ['t1', { ...ON_CALL_T1, arrivesEveryPayPeriod: true }],
  ['t2', { ...ON_CALL_T2, arrivesEveryPayPeriod: true }],
])

/** One earnings line for one of the allowances, which never earns super. */
function onCallLine(sourceInflowId: string, label: string, amountCents: Money): PayslipEarningLine {
  return { kind: 'earning', sourceInflowId, label, amountCents, attractsSuper: false }
}

/** The fortnight that carried both on-call tiers: $5,670.00 gross over three lines. */
const SHIFT_LINES: readonly PayslipEarningLine[] = [
  salaryLine(5_000_00),
  onCallLine('t1', 'On-call (T1)', 480_00),
  onCallLine('t2', 'On-call (T2)', 190_00),
]

/** That fortnight's slip: 1–14 July, paid 15 July. */
function shiftFortnight(overrides: Partial<PayslipActuals> = {}): PayslipActuals {
  return payslip({
    ...period('2026-07-01', '2026-07-14'),
    grossCents: 5_670_00,
    lines: SHIFT_LINES,
    ...overrides,
  })
}

/** The next fortnight, no shift worked: the salary alone, exactly to plan. */
function quietFortnight(overrides: Partial<PayslipActuals> = {}): PayslipActuals {
  return payslip({
    ...period('2026-07-15', '2026-07-28'),
    grossCents: 5_000_00,
    lines: [salaryLine(5_000_00)],
    ...overrides,
  })
}

/** That pair of slips measured against `inflowsById`. */
function onCallVariance(
  slip: PayslipActuals,
  inflows: ReadonlyMap<string, ReconciledInflow> = ON_CALL_INFLOWS,
): PayslipVariance {
  return payslipVariance(slip, expectation({ inflowsById: inflows }))
}

describe('an inflow that arrives in only some pay periods', () => {
  it('leaves a fortnight with no on-call line reading as on plan', () => {
    const variance = onCallVariance(quietFortnight())
    expect(variance.expectedGrossCents).toBe(5_000_00)
    expect(variance.grossVarianceCents).toBe(0)
    expect(variance.grossPartlyUnmeasured).toBe(false)
    expect(variance.unmeasuredGrossCents).toBe(0)
  })

  it('reports no expectation and no variance for each occasional group', () => {
    expect(onCallVariance(shiftFortnight()).lineGroups).toEqual([
      {
        sourceInflowId: 'salary',
        labels: ['Ordinary Hours'],
        actualCents: 5_000_00,
        expectedCents: 5_000_00,
        varianceCents: 0,
        basis: 'cadence',
        partCycleReason: null,
      },
      {
        sourceInflowId: 't1',
        labels: ['On-call (T1)'],
        actualCents: 480_00,
        expectedCents: null,
        varianceCents: null,
        basis: 'occasional',
        partCycleReason: null,
      },
      {
        sourceInflowId: 't2',
        labels: ['On-call (T2)'],
        actualCents: 190_00,
        expectedCents: null,
        varianceCents: null,
        basis: 'occasional',
        partCycleReason: null,
      },
    ])
  })

  it('keeps a fortnight that did carry on-call from reading above plan', () => {
    const variance = onCallVariance(shiftFortnight())
    expect(variance.grossVarianceCents).toBeNull()
    expect(variance.grossPartlyUnmeasured).toBe(true)
    expect(variance.unmeasuredGrossCents).toBe(670_00)
    // The same slip against every-period allowances reads $316.15 above plan —
    // $670.00 paid against the $353.85 a year's worth smoothed over 26 fortnights
    // comes to — which is the smoothing rather than pay off plan.
    expect(onCallVariance(shiftFortnight(), EVERY_PERIOD_INFLOWS).grossVarianceCents).toBe(316_15)
  })

  it('keeps a light on-call fortnight from reading below plan', () => {
    // One shift instead of two. Against a smoothed $253.85 the group reads $153.85
    // below plan; no period was ever owed a share of the year, so it reads as
    // unmeasured instead.
    const oneShift = shiftFortnight({
      grossCents: 5_100_00,
      lines: [salaryLine(5_000_00), onCallLine('t1', 'On-call (T1)', 100_00)],
    })
    expect(onCallVariance(oneShift).lineGroups[1]?.varianceCents).toBeNull()
    expect(onCallVariance(oneShift, EVERY_PERIOD_INFLOWS).lineGroups[1]?.varianceCents).toBe(
      -153_85,
    )
  })

  it('forfeits the slip’s gross total rather than counting an occasional group as nil', () => {
    // Excluding the group would hold the whole $5,670.00 gross against the salary's
    // $5,000.00 alone, reporting the allowance that was really paid as above plan.
    const variance = onCallVariance(shiftFortnight())
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.expectedGrossCents).not.toBe(5_000_00)
  })

  it('leaves a group with no resolvable inflow out of the total as before', () => {
    // An unmapped line's earnings really are unexplained, so they still read as gross
    // above plan; only an occasional group — whose projection exists and is annual —
    // forfeits the total.
    const variance = onCallVariance(
      quietFortnight({
        grossCents: 5_500_00,
        lines: [salaryLine(5_000_00), { ...salaryLine(500_00), sourceInflowId: null }],
      }),
    )
    expect(variance.grossPartlyUnmeasured).toBe(false)
    expect(variance.expectedGrossCents).toBe(5_000_00)
    expect(variance.grossVarianceCents).toBe(500_00)
  })

  it('never anchors the pay cycle on an occasional inflow, however large its group', () => {
    // A back-pay of allowances: on-call is most of the payment, yet the cycle the
    // employer withholds on is still the salary's fortnightly one.
    const variance = onCallVariance(
      shiftFortnight({
        grossCents: 5_000_00,
        lines: [salaryLine(1_000_00), onCallLine('t1', 'On-call (T1)', 4_000_00)],
      }),
    )
    expect(variance.cadenceInflowId).toBe('salary')
    expect(variance.basis).toBe('cadence')
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)
  })

  it('falls back to calendar days where every group is occasional', () => {
    const variance = onCallVariance(
      shiftFortnight({ grossCents: 480_00, lines: [onCallLine('t1', 'On-call (T1)', 480_00)] }),
    )
    expect(variance.cadenceInflowId).toBeNull()
    expect(variance.basis).toBe('calendar_days')
    expect(variance.expectedTaxWithheldCents).toBe(DAY_PRORATED_WITHHELD)
  })

  it('annualises to the projection whether or not it arrives every period', () => {
    expect(annualInflowGrossCents(ON_CALL_T1)).toBe(6_600_00)
    expect(annualInflowGrossCents({ ...ON_CALL_T1, arrivesEveryPayPeriod: true })).toBe(6_600_00)
  })

  it('projects no per-period gross, where an every-period inflow would', () => {
    expect(expectedPeriodGrossCents(ON_CALL_T1, FORTNIGHT, FY)).toBeNull()
    expect(
      expectedPeriodGrossCents({ ...ON_CALL_T1, arrivesEveryPayPeriod: true }, FORTNIGHT, FY),
    ).toBe(253_85)
  })

  it('still reads a whole turn of its cadence as a whole turn', () => {
    // Whether the period fits the cycle and whether the money lands every turn of it
    // are separate questions, and the flag answers only the second.
    expect(isPeriodOnCadence(ON_CALL_T1, FORTNIGHT)).toBe(true)
  })
})

/**
 * A $40,000 redundancy paid on 15 September 2026: money that lands once, on a day of
 * its own. Its `schedule` is read by nothing — a one-off is annualised to its own
 * amount and held against no cycle — and it earns no super, being no part of
 * ordinary time earnings.
 */
const REDUNDANCY: ReconciledInflow = {
  type: 'other',
  schedule: 'annual',
  amountCents: 40_000_00,
  paidOn: '2026-09-15',
  attractsSuper: false,
}

/** The salary and the redundancy paid out beside it, keyed as the slips name them. */
const REDUNDANCY_INFLOWS = new Map<string, ReconciledInflow>([
  ['salary', SALARY],
  ['redundancy', REDUNDANCY],
])

/** One earnings line for the redundancy, which never earns super. */
function redundancyLine(amountCents: Money): PayslipEarningLine {
  return {
    kind: 'earning',
    sourceInflowId: 'redundancy',
    label: 'Redundancy',
    amountCents,
    attractsSuper: false,
  }
}

/** The final fortnight, 2–15 September: the salary plus the redundancy beside it. */
function finalFortnight(overrides: Partial<PayslipActuals> = {}): PayslipActuals {
  return payslip({
    ...period('2026-09-02', '2026-09-15'),
    grossCents: 45_000_00,
    lines: [salaryLine(5_000_00), redundancyLine(40_000_00)],
    ...overrides,
  })
}

/** That slip measured against `inflows`. */
function redundancyVariance(
  slip: PayslipActuals,
  inflows: ReadonlyMap<string, ReconciledInflow> = REDUNDANCY_INFLOWS,
): PayslipVariance {
  return payslipVariance(slip, expectation({ inflowsById: inflows }))
}

describe('a one-off inflow', () => {
  it('annualises to its own amount, with no frequency multiplied in', () => {
    expect(annualInflowGrossCents(REDUNDANCY)).toBe(40_000_00)
    // The amount is the whole payment however the row's frequency reads, where the
    // same figure recurring monthly is twelve payments and annualises to twelve.
    expect(annualInflowGrossCents({ ...REDUNDANCY, schedule: 'monthly' })).toBe(40_000_00)
    expect(annualInflowGrossCents({ ...REDUNDANCY, schedule: 'monthly', paidOn: null })).toBe(
      480_000_00,
    )
  })

  it('treats a missing amount as nothing', () => {
    expect(
      annualInflowGrossCents({ type: 'other', schedule: 'annual', paidOn: '2026-09-15' }),
    ).toBe(0)
  })

  it('holds no per-period expectation, on a basis of its own', () => {
    expect(expectedPeriodGrossCents(REDUNDANCY, FORTNIGHT, FY)).toBeNull()
    expect(redundancyVariance(finalFortnight()).lineGroups[1]).toEqual({
      sourceInflowId: 'redundancy',
      labels: ['Redundancy'],
      actualCents: 40_000_00,
      expectedCents: null,
      varianceCents: null,
      basis: 'one_off',
      partCycleReason: null,
    })
  })

  it('reads as a one-off before any question about turns of a cycle', () => {
    // Landing on a day of its own is the more fundamental fact, so a row that also
    // claims to arrive every period — or only some — is a one-off either way.
    const inflows = new Map<string, ReconciledInflow>([
      ['salary', SALARY],
      ['redundancy', { ...REDUNDANCY, arrivesEveryPayPeriod: false }],
    ])
    expect(redundancyVariance(finalFortnight(), inflows).lineGroups[1]?.basis).toBe('one_off')
  })

  it('forfeits the slip’s gross total rather than reading as gross above plan', () => {
    // Holding the whole $45,000 gross against the salary's $5,000 alone would report
    // the redundancy that was really paid as $40,000 above plan.
    const variance = redundancyVariance(finalFortnight())
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.grossVarianceCents).toBeNull()
    expect(variance.grossPartlyUnmeasured).toBe(true)
    expect(variance.unmeasuredGrossCents).toBe(40_000_00)
  })

  it('never anchors the pay cycle, however large its group', () => {
    // The redundancy is eight times the fortnight's salary and says nothing at all
    // about how often the employer pays; the salary's fortnightly cycle still is.
    const variance = redundancyVariance(finalFortnight())
    expect(variance.cadenceInflowId).toBe('salary')
    expect(variance.basis).toBe('cadence')
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)
  })

  it('falls back to calendar days where the slip is nothing but a one-off', () => {
    const variance = redundancyVariance(
      finalFortnight({ grossCents: 40_000_00, lines: [redundancyLine(40_000_00)] }),
    )
    expect(variance.cadenceInflowId).toBeNull()
    expect(variance.basis).toBe('calendar_days')
    expect(variance.expectedTaxWithheldCents).toBe(DAY_PRORATED_WITHHELD)
  })
})

describe('unmeasuredInflowPositions', () => {
  /**
   * One slip as a year's reading takes it: the date it was paid, and the measurement
   * its own card renders — which is where its occasional groups are already summed.
   */
  function paid(
    paidOn: string,
    lines: readonly PayslipLine[] = [],
    inflows: ReadonlyMap<string, ReconciledInflow> = ON_CALL_INFLOWS,
  ): UnmeasuredPositionRow {
    return {
      paidOn,
      periodEnd: paidOn,
      variance: onCallVariance(payslip({ ...period(paidOn, paidOn), lines }), inflows),
    }
  }

  /** The household's two fortnights: one that carried both tiers, one that carried neither. */
  const FORTNIGHTS: readonly UnmeasuredPositionRow[] = [
    paid('2026-07-15', SHIFT_LINES),
    paid('2026-07-29', [salaryLine(5_000_00)]),
  ]

  it('measures each occasional inflow across the year, to the latest pay', () => {
    // 1 July through 29 July is 29 of FY2027's 365 days: $6,600 × 29/365 = $524.38
    // and $2,600 × 29/365 = $206.58, against the $480.00 and $190.00 really paid.
    expect(unmeasuredInflowPositions(FORTNIGHTS, ON_CALL_INFLOWS, FY)).toEqual([
      {
        sourceInflowId: 't1',
        actualCents: 480_00,
        expectedCents: 524_38,
        varianceCents: -44_38,
        annualExpectedCents: 6_600_00,
        asAt: '2026-07-29',
      },
      {
        sourceInflowId: 't2',
        actualCents: 190_00,
        expectedCents: 206_58,
        varianceCents: -16_58,
        annualExpectedCents: 2_600_00,
        asAt: '2026-07-29',
      },
    ])
  })

  it('sums every line drawing on one occasional inflow, across every slip', () => {
    const positions = unmeasuredInflowPositions(
      [
        paid('2026-07-15', [
          onCallLine('t1', 'On-call (T1)', 480_00),
          onCallLine('t1', 'On-call (T1) adjustment', 20_00),
        ]),
        paid('2026-07-29', [onCallLine('t1', 'On-call (T1)', 100_00)]),
      ],
      ON_CALL_INFLOWS,
      FY,
    )
    expect(positions).toHaveLength(1)
    expect(positions[0]?.actualCents).toBe(600_00)
  })

  it('sums the group figures the cards show rather than measuring the lines again', () => {
    const shift = FORTNIGHTS[0]!
    const onCallGroup = shift.variance.lineGroups.find((group) => group.sourceInflowId === 't1')
    const [position] = unmeasuredInflowPositions([shift], ON_CALL_INFLOWS, FY)
    expect(onCallGroup?.basis).toBe('occasional')
    expect(position?.actualCents).toBe(onCallGroup?.actualCents)
  })

  it('reports nothing for a steady inflow, an unmapped line, or a tax line', () => {
    expect(
      unmeasuredInflowPositions(
        [
          paid('2026-07-15', [
            salaryLine(5_000_00),
            { ...salaryLine(100_00), sourceInflowId: null },
            ...HEIDI_TAX_LINES,
          ]),
        ],
        ON_CALL_INFLOWS,
        FY,
      ),
    ).toEqual([])
  })

  it('reports only the inflows these slips actually name', () => {
    // A co-member's occasional inflow sits in the same household-wide map; it is no
    // part of this member's position, and nothing on their slips names it.
    const positions = unmeasuredInflowPositions(
      [paid('2026-07-15', [onCallLine('t1', 'On-call (T1)', 480_00)])],
      ON_CALL_INFLOWS,
      FY,
    )
    expect(positions.map((position) => position.sourceInflowId)).toEqual(['t1'])
  })

  it('reports nothing where the line’s inflow is not carried, or no inflows are', () => {
    const gone = [onCallLine('gone', 'On-call (T1)', 480_00)]
    expect(unmeasuredInflowPositions([paid('2026-07-15', gone)], ON_CALL_INFLOWS, FY)).toEqual([])
    expect(unmeasuredInflowPositions([paid('2026-07-15', gone, new Map())], undefined, FY)).toEqual(
      [],
    )
  })

  it('reports nothing for no slips, or slips with no lines', () => {
    expect(unmeasuredInflowPositions([], ON_CALL_INFLOWS, FY)).toEqual([])
    expect(unmeasuredInflowPositions([paid('2026-07-15')], ON_CALL_INFLOWS, FY)).toEqual([])
  })

  it('runs to the latest pay whatever order the slips arrive in', () => {
    const [reversed] = unmeasuredInflowPositions([...FORTNIGHTS].reverse(), ON_CALL_INFLOWS, FY)
    expect(reversed?.asAt).toBe('2026-07-29')
  })

  it('measures a one-off as a step: the whole amount from the day it lands', () => {
    // No proration. The redundancy is not two thirds paid because two thirds of the
    // year has run; it is expected in full from 15 September and not before.
    expect(
      unmeasuredInflowPositions(
        [paid('2026-09-15', [redundancyLine(40_000_00)], REDUNDANCY_INFLOWS)],
        REDUNDANCY_INFLOWS,
        FY,
      ),
    ).toEqual([
      {
        sourceInflowId: 'redundancy',
        actualCents: 40_000_00,
        expectedCents: 40_000_00,
        varianceCents: 0,
        annualExpectedCents: 40_000_00,
        asAt: '2026-09-15',
      },
    ])
  })

  it('expects nothing of a one-off the year has not reached', () => {
    // Paid out five days before the date the projection names it for: the year is
    // ahead of plan by the whole amount rather than short of a payment nothing is
    // owed yet.
    const [position] = unmeasuredInflowPositions(
      [paid('2026-09-10', [redundancyLine(40_000_00)], REDUNDANCY_INFLOWS)],
      REDUNDANCY_INFLOWS,
      FY,
    )
    expect(position?.expectedCents).toBe(0)
    expect(position?.varianceCents).toBe(40_000_00)
    expect(position?.annualExpectedCents).toBe(40_000_00)
  })

  it('reads each unmeasured inflow on its own terms, in one year’s reading', () => {
    // An on-call allowance and a redundancy on one slip: the first prorated across
    // the days run through, the second stepped in whole.
    const inflows = new Map<string, ReconciledInflow>([...ON_CALL_INFLOWS, ...REDUNDANCY_INFLOWS])
    const lines = [
      salaryLine(5_000_00),
      onCallLine('t1', 'On-call (T1)', 480_00),
      redundancyLine(40_000_00),
    ]
    expect(
      unmeasuredInflowPositions([paid('2026-09-15', lines, inflows)], inflows, FY).map(
        (position) => [position.sourceInflowId, position.expectedCents],
      ),
    ).toEqual([
      // 1 July through 15 September is 77 of FY2027's 365 days: $6,600 × 77/365.
      ['t1', 1_392_33],
      ['redundancy', 40_000_00],
    ])
  })

  it('counts only the days a dated inflow was effective for', () => {
    // Starting 15 July, the allowance was live for 15 of the 29 days to the latest
    // pay and for 351 of the year's 365.
    const dated = new Map([['t1', { ...ON_CALL_T1, startsOn: '2026-07-15' }]])
    const [position] = unmeasuredInflowPositions(
      [paid('2026-07-15', SHIFT_LINES, dated), paid('2026-07-29', [salaryLine(5_000_00)], dated)],
      dated,
      FY,
    )
    expect(position?.expectedCents).toBe(271_23)
    expect(position?.annualExpectedCents).toBe(6_346_85)
  })
})
