import { describe, expect, it } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import { makeInflow, makePayslip, makePayslipLine } from '../test/fixtures'
import {
  financialYearForPayPeriod,
  linesForPayslip,
  paygWithheldFromRows,
  payslipTotalsFromRows,
  payslipVarianceFor,
  reconciledInflowsById,
  reportedYearToDateFromRows,
  toPayslipLine,
  toPayslipTotalsRow,
  toReconciledInflow,
} from './payslips'
import { estimateHouseholdTaxFromRows } from './tax'

const config = FY2027_CONFIG
const inflow = makeInflow({ amount_cents: 5_000_00, schedule: 'fortnightly' })
const memberEstimate = estimateHouseholdTaxFromRows([inflow], [], [], [], [], config).members[0]!

/** The real slip driving per-inflow variance: $130,000 salary plus an on-call allowance. */
const ON_CALL = makeInflow({
  id: 'i2',
  name: 'On-call (T1)',
  amount_cents: 450_00,
  attracts_super: false,
})

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

describe('toReconciledInflow', () => {
  it('carries the row’s super treatment onto the projection', () => {
    expect(toReconciledInflow(ON_CALL).attractsSuper).toBe(false)
    expect(toReconciledInflow(inflow).attractsSuper).toBe(true)
  })
})

describe('reconciledInflowsById', () => {
  it('keys each projection by its inflow id', () => {
    const byId = reconciledInflowsById([inflow, ON_CALL])
    expect(byId.get('i1')?.amountCents).toBe(5_000_00)
    expect(byId.get('i2')?.amountCents).toBe(450_00)
  })
})

describe('toPayslipLine', () => {
  it('maps the row to the earnings line the plan groups', () => {
    expect(toPayslipLine(makePayslipLine())).toEqual({
      sourceInflowId: 'i1',
      label: 'Ordinary Hours',
      amountCents: 5_000_00,
    })
  })
})

describe('linesForPayslip', () => {
  it('picks out only the lines belonging to the slip', () => {
    const mine = makePayslipLine()
    const theirs = makePayslipLine({ id: 'pl2', payslip_id: 'ps2' })
    expect(linesForPayslip([mine, theirs], 'ps1')).toEqual([mine])
  })
})

describe('payslipVarianceFor', () => {
  it('measures the slip against its reconciled inflow and the member’s estimate', () => {
    const payslip = makePayslip()
    const variance = payslipVarianceFor(payslip, [], [inflow], memberEstimate, config)

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
    expect(payslipVarianceFor(payslip, [], [inflow], memberEstimate, config).actualSuperCents).toBe(
      700_00,
    )
  })

  it('has no gross expectation when the slip reconciles against no inflow', () => {
    const variance = payslipVarianceFor(
      makePayslip({ source_inflow_id: null }),
      [],
      [inflow],
      memberEstimate,
      config,
    )
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.grossVarianceCents).toBeNull()
    expect(variance.basis).toBe('calendar_days')
  })

  it('has no gross expectation when the reconciled inflow has been retired', () => {
    const variance = payslipVarianceFor(makePayslip(), [], [], memberEstimate, config)
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.basis).toBe('calendar_days')
  })

  it('expects nothing withheld for a member with no estimate', () => {
    const variance = payslipVarianceFor(makePayslip(), [], [inflow], undefined, config)
    expect(variance.expectedTaxWithheldCents).toBe(0)
    expect(variance.taxWithheldVarianceCents).toBe(1_000_00)
  })

  // The real Heidi Health slip: $130,000 salary paid fortnightly, split across
  // ordinary hours and annual leave, plus a $495.50 on-call allowance. Ordinary
  // hours and annual leave both draw on the salary, so the salary group's
  // variance is nil; only the allowance's lumpiness shows.
  it('groups the lines of one slip by the inflow each draws on', () => {
    const payslip = makePayslip({
      period_start: '2026-06-27',
      period_end: '2026-07-10',
      paid_on: '2026-07-13',
      gross_cents: 5_495_50,
      tax_withheld_cents: 1_850_00,
      super_cents: 600_00,
      net_cents: 3_645_50,
    })
    const lines = [
      makePayslipLine({ id: 'pl1', label: 'Ordinary Hours', amount_cents: 4_000_00 }),
      makePayslipLine({ id: 'pl2', label: 'Annual Leave', amount_cents: 1_000_00 }),
      makePayslipLine({
        id: 'pl3',
        label: 'On-call (T1)',
        amount_cents: 495_50,
        source_inflow_id: 'i2',
      }),
    ]
    const variance = payslipVarianceFor(payslip, lines, [inflow, ON_CALL], memberEstimate, config)

    expect(variance.lineGroups).toEqual([
      {
        sourceInflowId: 'i1',
        labels: ['Ordinary Hours', 'Annual Leave'],
        actualCents: 5_000_00,
        expectedCents: 5_000_00,
        varianceCents: 0,
        basis: 'cadence',
      },
      {
        sourceInflowId: 'i2',
        labels: ['On-call (T1)'],
        actualCents: 495_50,
        expectedCents: 450_00,
        varianceCents: 45_50,
        basis: 'cadence',
      },
    ])
    expect(variance.unallocatedCents).toBe(0)
    expect(variance.expectedGrossCents).toBe(5_450_00)
  })

  // The bug this feature exists to fix: the employer paid super on the $5,000
  // salary, not on the $5,495.50 that includes on-call. 12% of $5,495.50 would be
  // $659.46, and the slip would read $59.46 below plan for no reason.
  it('charges the expected super guarantee on the gross less the non-OTE lines', () => {
    const payslip = makePayslip({ gross_cents: 5_495_50, super_cents: 600_00 })
    const lines = [
      makePayslipLine({ id: 'pl1', label: 'Ordinary Hours', amount_cents: 4_000_00 }),
      makePayslipLine({ id: 'pl2', label: 'Annual Leave', amount_cents: 1_000_00 }),
      makePayslipLine({
        id: 'pl3',
        label: 'On-call (T1)',
        amount_cents: 495_50,
        source_inflow_id: 'i2',
      }),
    ]
    const variance = payslipVarianceFor(payslip, lines, [inflow, ON_CALL], memberEstimate, config)

    expect(variance.superBaseCents).toBe(5_000_00)
    expect(variance.expectedSuperGuaranteeCents).toBe(600_00)
    expect(variance.superVarianceCents).toBe(0)
  })
})
