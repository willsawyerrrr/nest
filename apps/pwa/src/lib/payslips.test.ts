import { describe, expect, it } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import { makeInflow, makePayslip } from '../test/fixtures'
import {
  financialYearForPayPeriod,
  paygWithheldFromRows,
  payslipTotalsFromRows,
  payslipVarianceFor,
  reportedYearToDateFromRows,
  toPayslipTotalsRow,
} from './payslips'
import { estimateHouseholdTaxFromRows } from './tax'

const config = FY2027_CONFIG
const inflow = makeInflow({ amount_cents: 5_000_00, schedule: 'fortnightly' })
const memberEstimate = estimateHouseholdTaxFromRows([inflow], [], [], [], [], config).members[0]!

describe('financialYearForPayPeriod', () => {
  it('files a period ending on 1 July under the year the financial year ends in', () => {
    expect(financialYearForPayPeriod('2026-07-01')).toBe(2027)
  })

  it('files a period ending on 30 June under that same year', () => {
    expect(financialYearForPayPeriod('2026-06-30')).toBe(2026)
  })
})

describe('toPayslipTotalsRow', () => {
  it('maps the row to the aggregation shape, carrying the nullable figures', () => {
    expect(
      toPayslipTotalsRow(
        makePayslip({ salary_sacrifice_cents: 100_00, ytd_gross_cents: 20_000_00 }),
      ),
    ).toEqual({
      memberId: 'm1',
      periodEnd: '2026-07-14',
      grossCents: 5_000_00,
      taxWithheldCents: 1_000_00,
      superCents: 600_00,
      salarySacrificeCents: 100_00,
      ytdGrossCents: 20_000_00,
      ytdTaxWithheldCents: null,
      ytdSuperCents: null,
    })
  })
})

describe('paygWithheldFromRows', () => {
  it('sums each member’s withheld tax and omits members with no payslips', () => {
    const withheld = paygWithheldFromRows([
      makePayslip(),
      makePayslip({ id: 'ps2', tax_withheld_cents: 200_00 }),
      makePayslip({ id: 'ps3', member_id: 'm2', tax_withheld_cents: 50_00 }),
    ])
    expect(withheld.get('m1')).toBe(1_200_00)
    expect(withheld.get('m2')).toBe(50_00)
    expect(withheld.has('m3')).toBe(false)
  })

  it('is empty with no payslips', () => {
    expect(paygWithheldFromRows([]).size).toBe(0)
  })
})

describe('payslipTotalsFromRows', () => {
  it('sums the actual figures and counts the slips', () => {
    expect(
      payslipTotalsFromRows([
        makePayslip(),
        makePayslip({ id: 'ps2', salary_sacrifice_cents: 25_00 }),
      ]),
    ).toEqual({
      grossCents: 10_000_00,
      taxWithheldCents: 2_000_00,
      superCents: 1_200_00,
      salarySacrificeCents: 25_00,
      payslipCount: 2,
    })
  })
})

describe('reportedYearToDateFromRows', () => {
  it('reads the running totals off the latest slip that carries all three', () => {
    expect(
      reportedYearToDateFromRows([
        makePayslip({
          ytd_gross_cents: 5_000_00,
          ytd_tax_withheld_cents: 1_000_00,
          ytd_super_cents: 600_00,
        }),
        makePayslip({
          id: 'ps2',
          period_end: '2026-07-28',
          ytd_gross_cents: 10_000_00,
          ytd_tax_withheld_cents: 2_000_00,
          ytd_super_cents: 1_200_00,
        }),
      ]),
    ).toEqual({ grossCents: 10_000_00, taxWithheldCents: 2_000_00, superCents: 1_200_00 })
  })

  it('is null when no slip reports a complete set', () => {
    expect(reportedYearToDateFromRows([makePayslip()])).toBeNull()
  })
})

describe('payslipVarianceFor', () => {
  it('measures the slip against its reconciled inflow and the member’s estimate', () => {
    const payslip = makePayslip()
    const variance = payslipVarianceFor(payslip, inflow, memberEstimate, config)

    // A whole fortnight of a fortnightly inflow is one turn of its cadence, so
    // the expectation is the per-period pay itself and the slip matches it.
    expect(variance.basis).toBe('cadence')
    expect(variance.expectedGrossCents).toBe(5_000_00)
    expect(variance.grossVarianceCents).toBe(0)
    expect(variance.expectedTaxWithheldCents).toBeGreaterThan(0)
    expect(variance.taxWithheldVarianceCents).toBe(
      payslip.tax_withheld_cents - variance.expectedTaxWithheldCents,
    )
    expect(variance.expectedSuperGuaranteeCents).toBe(
      Math.round(payslip.gross_cents * config.super.guaranteeRate),
    )
  })

  it('counts salary sacrifice as part of the slip’s super', () => {
    const payslip = makePayslip({ salary_sacrifice_cents: 100_00 })
    expect(payslipVarianceFor(payslip, inflow, memberEstimate, config).actualSuperCents).toBe(
      700_00,
    )
  })

  it('has no gross expectation when the slip reconciles against no inflow', () => {
    const variance = payslipVarianceFor(
      makePayslip({ source_inflow_id: null }),
      undefined,
      memberEstimate,
      config,
    )
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.grossVarianceCents).toBeNull()
    expect(variance.basis).toBe('calendar_days')
  })

  it('expects nothing withheld for a member with no estimate', () => {
    const variance = payslipVarianceFor(makePayslip(), inflow, undefined, config)
    expect(variance.expectedTaxWithheldCents).toBe(0)
    expect(variance.taxWithheldVarianceCents).toBe(1_000_00)
  })
})
