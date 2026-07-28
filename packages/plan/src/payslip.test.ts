import { describe, expect, it } from 'vitest'
import {
  annualInflowGrossCents,
  expectedPeriodGrossCents,
  financialYearDayCount,
  isPeriodOnCadence,
  latestReportedYearToDate,
  paygWithheldByMember,
  payslipVariance,
  payslipYearToDate,
  payslipYearToDateByMember,
  periodFractionOfFinancialYear,
  prorateAnnualToPeriod,
  type PayPeriod,
  type PayslipActuals,
  type PayslipExpectation,
  type PayslipTotalsRow,
  type ReconciledInflow,
  type SuperGuaranteeConfig,
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

/** $130,000 × 14/365 — the same fortnight apportioned by calendar days instead. */
const DAY_PRORATED_GROSS = 4_986_30

/** $36,400 × 14/365. */
const DAY_PRORATED_WITHHELD = 1_396_16

/** A monthly $10,000 salary — $120,000 annualised. */
const MONTHLY: ReconciledInflow = { type: 'salary', schedule: 'monthly', amountCents: 10_000_00 }

/** A payslip on cadence and matching the plan exactly, before any override. */
function payslip(overrides: Partial<PayslipActuals> = {}): PayslipActuals {
  return {
    financialYear: FY,
    ...FORTNIGHT,
    grossCents: CADENCE_GROSS,
    taxWithheldCents: CADENCE_WITHHELD,
    superCents: CADENCE_SUPER,
    ...overrides,
  }
}

/** The plan's expectation for that payslip, before any override. */
function expectation(overrides: Partial<PayslipExpectation> = {}): PayslipExpectation {
  return {
    inflow: SALARY,
    annualTaxCents: ANNUAL_TAX,
    superConfig: SUPER_CONFIG,
    ...overrides,
  }
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

describe('financialYearDayCount', () => {
  it('counts 365 days in a financial year ending in a non-leap year', () => {
    expect(financialYearDayCount(2027)).toBe(365)
  })

  it('counts 366 days in a financial year ending in a leap year', () => {
    // FY2028 runs 1 Jul 2027 – 30 Jun 2028 and so contains 29 Feb 2028.
    expect(financialYearDayCount(2028)).toBe(366)
  })
})

describe('periodFractionOfFinancialYear', () => {
  it('is the period’s inclusive day count over the financial year’s', () => {
    expect(periodFractionOfFinancialYear(FORTNIGHT, FY)).toBe(14 / 365)
  })

  it('counts every day of a period straddling 30 June', () => {
    expect(periodFractionOfFinancialYear(period('2027-06-24', '2027-07-07'), FY)).toBe(14 / 365)
  })

  it('covers nothing for a period ending before it starts', () => {
    expect(periodFractionOfFinancialYear(period('2026-07-14', '2026-07-01'), FY)).toBe(0)
  })
})

describe('prorateAnnualToPeriod', () => {
  it('prorates an annual figure to the period, to whole cents', () => {
    // $36,500 × 14/365 = $1,400.00 exactly.
    expect(prorateAnnualToPeriod(36_500_00, FORTNIGHT, FY)).toBe(1_400_00)
    // $130,000 × 14/365 = $4,986.3013… → $4,986.30.
    expect(prorateAnnualToPeriod(130_000_00, FORTNIGHT, FY)).toBe(DAY_PRORATED_GROSS)
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

  it('annualises an arbitrary cadence with no interval to zero', () => {
    expect(
      annualInflowGrossCents({ type: 'salary', schedule: 'every_n_weeks', amountCents: 1_000_00 }),
    ).toBe(0)
  })
})

describe('isPeriodOnCadence', () => {
  /** A $1-a-period inflow on `schedule`; the amount is irrelevant to the cadence. */
  function on(schedule: ReconciledInflow['schedule'], interval?: number): ReconciledInflow {
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

  it('apportions a part period by calendar days', () => {
    // 13 days of a 365-day year: $130,000 × 13/365 = $4,630.14.
    expect(expectedPeriodGrossCents(SALARY, period('2026-07-01', '2026-07-13'), FY)).toBe(4_630_14)
  })

  it('counts only the days from an inflow’s effective start', () => {
    // Active 8–14 July: 7 of the year's 365 days. $130,000 × 7/365 = $2,493.15.
    expect(expectedPeriodGrossCents({ ...SALARY, startsOn: '2026-07-08' }, FORTNIGHT, FY)).toBe(
      2_493_15,
    )
  })

  it('counts only the days through an inflow’s effective end', () => {
    // Active 1–7 July: the inclusive complement of the window above.
    expect(expectedPeriodGrossCents({ ...SALARY, endsOn: '2026-07-07' }, FORTNIGHT, FY)).toBe(
      2_493_15,
    )
  })

  it('has two adjacent dated inflows sum to the period’s calendar-day share', () => {
    // A mid-period pay rise: the old rate ends 7 July, the new rate starts 8 July.
    // Both are part periods, so both apportion by days and together cover the
    // period's day share — a shade under the whole-cadence figure.
    const ending = expectedPeriodGrossCents({ ...SALARY, endsOn: '2026-07-07' }, FORTNIGHT, FY)
    const starting = expectedPeriodGrossCents({ ...SALARY, startsOn: '2026-07-08' }, FORTNIGHT, FY)
    expect(ending + starting).toBe(DAY_PRORATED_GROSS)
    expect(ending + starting).toBeLessThan(CADENCE_GROSS)
  })

  it('expects nothing from an inflow whose window misses the period', () => {
    expect(expectedPeriodGrossCents({ ...SALARY, endsOn: '2026-06-30' }, FORTNIGHT, FY)).toBe(0)
  })
})

describe('payslipVariance on cadence', () => {
  it('reports exactly zero variance for a fortnightly payslip matching the projection', () => {
    expect(payslipVariance(payslip(), expectation())).toEqual({
      basis: 'cadence',
      periodDays: 14,
      financialYearDays: 365,
      periodFraction: 14 / 365,
      expectedGrossCents: CADENCE_GROSS,
      grossVarianceCents: 0,
      lineGroups: [],
      unallocatedCents: 0,
      expectedTaxWithheldCents: CADENCE_WITHHELD,
      taxWithheldVarianceCents: 0,
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
      expectation({ inflow: { type: 'salary', schedule: 'weekly', amountCents: 2_500_00 } }),
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
    expect(payslipVariance(july, expectation({ inflow: MONTHLY }))).toMatchObject({
      basis: 'cadence',
      periodDays: 31,
      expectedGrossCents: 10_000_00,
      grossVarianceCents: 0,
      expectedTaxWithheldCents: 3_033_33,
      taxWithheldVarianceCents: 0,
      superVarianceCents: 0,
    })

    // February's 28 days are a whole month too, so the same figures are expected of
    // it — a shorter month is not a shortfall.
    const february = payslipVariance(
      payslip({ ...july, ...period('2027-02-01', '2027-02-28') }),
      expectation({ inflow: MONTHLY }),
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
        inflow: { type: 'salary', schedule: 'every_n_weeks', amountCents: 6_000_00, interval: 3 },
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
  it('apportions every expectation by calendar days for a part period', () => {
    const variance = payslipVariance(
      payslip({ periodEnd: '2026-07-07', grossCents: 2_493_15, taxWithheldCents: 698_08 }),
      expectation(),
    )
    expect(variance.basis).toBe('calendar_days')
    expect(variance.periodDays).toBe(7)
    // $130,000 × 7/365 and $36,400 × 7/365.
    expect(variance.expectedGrossCents).toBe(2_493_15)
    expect(variance.grossVarianceCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBe(698_08)
    expect(variance.taxWithheldVarianceCents).toBe(0)
  })

  it('switches basis between a whole fortnight and one a day short of it', () => {
    const whole = payslipVariance(payslip(), expectation())
    expect(whole.basis).toBe('cadence')
    expect(whole.expectedGrossCents).toBe(CADENCE_GROSS)
    expect(whole.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)

    const partial = payslipVariance(payslip({ periodEnd: '2026-07-13' }), expectation())
    expect(partial.basis).toBe('calendar_days')
    // $130,000 × 13/365 and $36,400 × 13/365.
    expect(partial.expectedGrossCents).toBe(4_630_14)
    expect(partial.expectedTaxWithheldCents).toBe(1_296_44)
  })

  it('switches basis at the shortest and longest calendar month', () => {
    const forPeriod = (periodStart: string, periodEnd: string) =>
      payslipVariance(
        payslip({ ...period(periodStart, periodEnd), grossCents: 10_000_00 }),
        expectation({ inflow: MONTHLY }),
      )

    // 28 days is February, a whole month; 27 days is no month at all.
    expect(forPeriod('2027-02-01', '2027-02-28').basis).toBe('cadence')
    const short = forPeriod('2026-07-01', '2026-07-27')
    expect(short.basis).toBe('calendar_days')
    // $120,000 × 27/365.
    expect(short.expectedGrossCents).toBe(8_876_71)

    // 31 days is the longest month; 32 is longer than any.
    expect(forPeriod('2026-07-01', '2026-07-31').basis).toBe('cadence')
    const long = forPeriod('2026-07-01', '2026-08-01')
    expect(long.basis).toBe('calendar_days')
    // $120,000 × 32/365.
    expect(long.expectedGrossCents).toBe(10_520_55)
  })

  it('expects no gross for a payslip reconciled against no inflow', () => {
    const unmapped = payslipVariance(payslip(), expectation({ inflow: null }))
    expect(unmapped.expectedGrossCents).toBeNull()
    expect(unmapped.grossVarianceCents).toBeNull()
    // With no inflow there is no cadence to read, so the member-level expectations
    // fall to calendar days: withholding from their annual estimated tax, and the
    // guarantee from the slip's own gross.
    expect(unmapped.basis).toBe('calendar_days')
    expect(unmapped.expectedTaxWithheldCents).toBe(DAY_PRORATED_WITHHELD)
    expect(unmapped.expectedSuperCents).toBe(CADENCE_SUPER)

    const absent = payslipVariance(payslip(), {
      annualTaxCents: ANNUAL_TAX,
      superConfig: SUPER_CONFIG,
    })
    expect(absent.expectedGrossCents).toBeNull()
    expect(absent.grossVarianceCents).toBeNull()
    expect(absent.basis).toBe('calendar_days')
  })

  it('apportions by days when the inflow’s effective dates clip the period', () => {
    const variance = payslipVariance(
      payslip({ grossCents: 2_493_15 }),
      expectation({ inflow: { ...SALARY, startsOn: '2026-07-08' } }),
    )
    expect(variance.basis).toBe('calendar_days')
    expect(variance.expectedGrossCents).toBe(2_493_15)
    expect(variance.grossVarianceCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBe(DAY_PRORATED_WITHHELD)
  })

  it('expects nothing of a period ending before it starts', () => {
    const variance = payslipVariance(
      payslip({ ...period('2026-07-14', '2026-07-01') }),
      expectation(),
    )
    expect(variance.basis).toBe('calendar_days')
    expect(variance.periodDays).toBe(0)
    expect(variance.periodFraction).toBe(0)
    expect(variance.expectedGrossCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBe(0)
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

/** The slip's three earnings lines: two on the salary, one on the allowance. */
const HEIDI_LINES = [
  { sourceInflowId: 'salary', label: 'Ordinary Hours', amountCents: 4_000_00 },
  { sourceInflowId: 'salary', label: 'Annual Leave', amountCents: 1_000_00 },
  { sourceInflowId: 'on-call', label: 'On-call (T1)', amountCents: 495_50 },
] as const

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

/** That slip's expectation: the salary as its cadence anchor, both inflows resolvable. */
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
      },
      {
        sourceInflowId: 'on-call',
        labels: ['On-call (T1)'],
        actualCents: 495_50,
        expectedCents: 450_00,
        varianceCents: 45_50,
        basis: 'cadence',
      },
    ])
  })

  it('keeps the allowance’s lumpiness out of the salary’s variance', () => {
    const [salary, onCall] = payslipVariance(heidiPayslip(), heidiExpectation()).lineGroups
    expect(salary?.varianceCents).toBe(0)
    expect(onCall?.varianceCents).toBe(45_50)
  })

  // The bug this change fixes: the employer paid 12% of the $5,000 salary, not
  // of the $5,495.50 gross. 12% of the whole gross would expect $659.46 and read
  // the slip as $59.46 below plan for no reason.
  it('charges the expected super guarantee on the gross less the non-OTE lines', () => {
    const variance = payslipVariance(heidiPayslip(), heidiExpectation())
    expect(variance.superBaseCents).toBe(5_000_00)
    expect(variance.expectedSuperGuaranteeCents).toBe(600_00)
    expect(variance.expectedSuperGuaranteeCents).not.toBe(659_46)
    expect(variance.superVarianceCents).toBe(0)
  })

  it('counts a line whose inflow says nothing about super toward the super base', () => {
    const unstated: ReconciledInflow = {
      type: 'other',
      schedule: 'fortnightly',
      amountCents: 450_00,
    }
    const variance = payslipVariance(
      heidiPayslip(),
      heidiExpectation({
        inflowsById: new Map([
          ['salary', SALARY],
          ['on-call', unstated],
        ]),
      }),
    )
    expect(variance.superBaseCents).toBe(5_495_50)
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
          { sourceInflowId: 'salary', label: 'Ordinary Hours', amountCents: 5_000_00 },
          { sourceInflowId: null, label: 'Bonus', amountCents: 495_50 },
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
    // A retired inflow says nothing about super either, so its line stays in the base.
    expect(variance.superBaseCents).toBe(5_495_50)
  })

  it('has no gross expectation when nothing on the slip maps to a projection', () => {
    const variance = payslipVariance(
      heidiPayslip({
        lines: [{ sourceInflowId: null, label: 'Bonus', amountCents: 5_495_50 }],
      }),
      heidiExpectation(),
    )
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.grossVarianceCents).toBeNull()
  })

  it('apportions a group by calendar days when the period is not one turn of its cadence', () => {
    const group = payslipVariance(
      heidiPayslip({ ...period('2026-06-27', '2026-07-03') }),
      heidiExpectation(),
    ).lineGroups[0]
    expect(group?.basis).toBe('calendar_days')
    // $130,000 × 7/365, the same proration a whole part-period slip gets.
    expect(group?.expectedCents).toBe(2_493_15)
  })

  it('reads the withholding basis from the slip’s cadence anchor, not its lines', () => {
    // Every line is on the fortnightly allowance, but the anchor is still the
    // fortnightly salary, so the withholding stays a per-cadence division.
    const variance = payslipVariance(heidiPayslip(), heidiExpectation())
    expect(variance.basis).toBe('cadence')
    expect(variance.expectedTaxWithheldCents).toBe(CADENCE_WITHHELD)
  })

  it('leaves an unitemised slip measured whole, with no groups and nothing unallocated', () => {
    const variance = payslipVariance(payslip({ lines: [] }), heidiExpectation())
    expect(variance.lineGroups).toEqual([])
    expect(variance.unallocatedCents).toBe(0)
    expect(variance.expectedGrossCents).toBe(CADENCE_GROSS)
    expect(variance.superBaseCents).toBe(CADENCE_GROSS)
  })
})
