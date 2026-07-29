import { describe, expect, it } from 'vitest'
import { expectedPeriodGrossCents } from '@nest/plan'
import { FY2027_CONFIG } from '@nest/tax'
import type { Inflow } from '../hooks/useInflows'
import type { PayslipLineRow } from '../hooks/usePayslipLines'
import type { PayslipRow } from '../hooks/usePayslips'
import { makeInflow, makePayslip, makePayslipLine, makePayslipTaxLine } from '../test/fixtures'
import {
  financialYearForPayslip,
  occasionalPositionsFor,
  paygWithheldFromRows,
  payslipCountByMember,
  payslipReconciliation,
  payslipTotalsFromRows,
  payslipVarianceFor,
  payslipVariancesById,
  payslipYearPositionsFromRows,
  reportedYearToDateFromRows,
  toPayslipLine,
  toPayslipTotalsRow,
  toReconciledInflow,
} from './payslips'
import { estimateHouseholdTaxFromRows } from './tax'

const config = FY2027_CONFIG
const inflow = makeInflow({ amount_cents: 5_000_00, schedule: 'fortnightly' })
const memberEstimate = estimateHouseholdTaxFromRows([inflow], [], [], [], [], config).members[0]!

/** The same member with a HELP debt, so their liability carries a compulsory repayment. */
const withHelpDebt = estimateHouseholdTaxFromRows(
  [inflow],
  [],
  [],
  [
    {
      id: 'hd1',
      household_id: 'h1',
      member_id: 'm1',
      balance_cents: 40_000_00,
      created_at: '',
      updated_at: '',
    },
  ],
  [],
  config,
).members[0]!

/** The real slip driving per-inflow variance: $130,000 salary plus an on-call allowance. */
const ON_CALL = makeInflow({
  id: 'i2',
  name: 'On-call (T1)',
  amount_cents: 450_00,
  attracts_super: false,
})

/** An on-call allowance projected at $6,600 a year, landing in only some fortnights. */
const OCCASIONAL_ON_CALL = makeInflow({
  id: 'i3',
  name: 'On-call (T1)',
  type: 'other',
  schedule: 'annual',
  amount_cents: 6_600_00,
  pay_schedule: 'fortnightly',
  arrives_every_pay_period: false,
  attracts_super: false,
})

describe('financialYearForPayslip', () => {
  it('files a fortnight worked to 28 June and paid 1 July under the later year', () => {
    expect(financialYearForPayslip({ paidOn: '2026-07-01', periodEnd: '2026-06-28' })).toBe(2027)
  })

  it('files a period worked into July but paid by 30 June under the earlier year', () => {
    expect(financialYearForPayslip({ paidOn: '2026-06-30', periodEnd: '2026-07-14' })).toBe(2026)
  })

  it('leaves a period earned and paid inside one year in that year', () => {
    expect(financialYearForPayslip({ paidOn: '2026-07-16', periodEnd: '2026-07-14' })).toBe(2027)
  })

  it('falls back to the period end where the slip states no payment date', () => {
    expect(financialYearForPayslip({ paidOn: null, periodEnd: '2026-07-01' })).toBe(2027)
    expect(financialYearForPayslip({ paidOn: null, periodEnd: '2026-06-30' })).toBe(2026)
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
      paidOn: '2026-07-15',
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

describe('payslipCountByMember', () => {
  it('counts each member’s slips and omits members with none', () => {
    const counts = payslipCountByMember([
      makePayslip(),
      makePayslip({ id: 'ps2' }),
      makePayslip({ id: 'ps3', member_id: 'm2' }),
    ])
    expect(counts.get('m1')).toBe(2)
    expect(counts.get('m2')).toBe(1)
    expect(counts.has('m3')).toBe(false)
  })

  it('separates a slip that withheld nothing from no slips at all', () => {
    const rows = [makePayslip({ tax_withheld_cents: 0 })]
    // Both cases sum to nil withholding; only the count tells them apart.
    expect(paygWithheldFromRows(rows).get('m1')).toBe(0)
    expect(payslipCountByMember(rows).get('m1')).toBe(1)
    expect(payslipCountByMember([]).size).toBe(0)
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
  it('reads the running totals off the slip whose pay landed last', () => {
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
          paid_on: '2026-07-29',
          ytd_gross_cents: 10_000_00,
          ytd_tax_withheld_cents: 2_000_00,
          ytd_super_cents: 1_200_00,
        }),
        // Back-pay for the first fortnight, paid after both: the employer's own
        // running totals include it, so its figures are the further-advanced ones.
        makePayslip({
          id: 'ps3',
          period_end: '2026-07-14',
          paid_on: '2026-08-12',
          ytd_gross_cents: 11_000_00,
          ytd_tax_withheld_cents: 2_400_00,
          ytd_super_cents: 1_320_00,
        }),
      ]),
    ).toEqual({ grossCents: 11_000_00, taxWithheldCents: 2_400_00, superCents: 1_320_00 })
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

  it('carries the cadence the money arrives on, apart from the amount’s own frequency', () => {
    const yearlyPaidFortnightly = toReconciledInflow(
      makeInflow({ schedule: 'annual', amount_cents: 130_000_00, pay_schedule: 'fortnightly' }),
    )
    expect(yearlyPaidFortnightly.schedule).toBe('annual')
    expect(yearlyPaidFortnightly.paySchedule).toBe('fortnightly')
    expect(yearlyPaidFortnightly.payInterval).toBeUndefined()
    // A 14-day period is one whole turn of the cycle the money lands on, so the slip is
    // measured against $130,000 ÷ 26 rather than its calendar-day share of the year.
    expect(
      expectedPeriodGrossCents(
        yearlyPaidFortnightly,
        { periodStart: '2026-07-01', periodEnd: '2026-07-14' },
        2027,
      ),
    ).toBe(5_000_00)
  })

  it('carries an arbitrary pay cadence’s interval', () => {
    const everyFourWeeks = toReconciledInflow(
      makeInflow({ pay_schedule: 'every_n_weeks', pay_interval_count: 4 }),
    )
    expect(everyFourWeeks.paySchedule).toBe('every_n_weeks')
    expect(everyFourWeeks.payInterval).toBe(4)
  })

  it('leaves the pay cadence off a row arriving on the amount’s own frequency', () => {
    expect(toReconciledInflow(inflow).paySchedule).toBeUndefined()
    expect(toReconciledInflow(inflow).payInterval).toBeUndefined()
  })

  it('carries whether the money lands on every turn of that cadence', () => {
    expect(toReconciledInflow(inflow).arrivesEveryPayPeriod).toBe(true)
    expect(toReconciledInflow(OCCASIONAL_ON_CALL).arrivesEveryPayPeriod).toBe(false)
    // No period is owed a share of an inflow that lands in only some of them.
    expect(
      expectedPeriodGrossCents(
        toReconciledInflow(OCCASIONAL_ON_CALL),
        { periodStart: '2026-07-01', periodEnd: '2026-07-14' },
        2027,
      ),
    ).toBeNull()
  })
})

describe('occasionalPositionsFor', () => {
  const shiftSlip = makePayslip({ gross_cents: 5_480_00, paid_on: '2026-07-15' })
  const quietSlip = makePayslip({
    id: 'ps2',
    period_start: '2026-07-15',
    period_end: '2026-07-28',
    paid_on: '2026-07-29',
  })
  const lines = [
    makePayslipLine(),
    makePayslipLine({
      id: 'pl2',
      source_inflow_id: 'i3',
      label: 'On-call (T1)',
      amount_cents: 480_00,
      attracts_super: false,
    }),
    makePayslipLine({ id: 'pl3', payslip_id: 'ps2' }),
  ]

  /** One member's slips measured once, exactly as their cards and their year read them. */
  function measured(
    payslips: readonly PayslipRow[],
    inflows: readonly Inflow[],
    rows: readonly PayslipLineRow[] = lines,
  ) {
    const reconciliation = payslipReconciliation(inflows, rows)
    return {
      reconciliation,
      variances: payslipVariancesById(payslips, reconciliation, memberEstimate, config),
    }
  }

  it('measures the year’s on-call against the projection to the latest pay', () => {
    const payslips = [shiftSlip, quietSlip]
    const { reconciliation, variances } = measured(payslips, [inflow, OCCASIONAL_ON_CALL])
    // 1–29 July is 29 of FY2027's 365 days: $6,600 × 29/365 = $524.38.
    expect(occasionalPositionsFor(payslips, variances, reconciliation, 2027)).toEqual([
      {
        sourceInflowId: 'i3',
        actualCents: 480_00,
        expectedCents: 524_38,
        varianceCents: -44_38,
        annualExpectedCents: 6_600_00,
        asAt: '2026-07-29',
      },
    ])
  })

  it('sums the very group figures the member’s cards show', () => {
    const payslips = [shiftSlip, quietSlip]
    const { reconciliation, variances } = measured(payslips, [inflow, OCCASIONAL_ON_CALL])
    const group = variances.get('ps1')!.lineGroups.find((each) => each.sourceInflowId === 'i3')

    expect(group?.basis).toBe('occasional')
    expect(occasionalPositionsFor(payslips, variances, reconciliation, 2027)[0]?.actualCents).toBe(
      group?.actualCents,
    )
  })

  it('reports nothing where no line draws on an occasional inflow', () => {
    const payslips = [shiftSlip]
    const { reconciliation, variances } = measured(payslips, [inflow], [makePayslipLine()])
    expect(occasionalPositionsFor(payslips, variances, reconciliation, 2027)).toEqual([])
  })
})

describe('payslipReconciliation', () => {
  it('keys each projection and each inflow name by its inflow id', () => {
    const { inflowsById, inflowNames } = payslipReconciliation([inflow, ON_CALL], [])
    expect(inflowsById.get('i1')?.amountCents).toBe(5_000_00)
    expect(inflowsById.get('i2')?.amountCents).toBe(450_00)
    expect(inflowNames.get('i2')).toBe('On-call (T1)')
  })

  it('groups every line under the slip it belongs to', () => {
    const mine = makePayslipLine()
    const alsoMine = makePayslipLine({ id: 'pl2', label: 'Annual Leave' })
    const theirs = makePayslipLine({ id: 'pl3', payslip_id: 'ps2' })
    const { linesByPayslip } = payslipReconciliation([], [mine, alsoMine, theirs])
    expect(linesByPayslip.get('ps1')).toEqual([mine, alsoMine])
    expect(linesByPayslip.get('ps2')).toEqual([theirs])
  })
})

describe('toPayslipLine', () => {
  it('maps an earnings row to the line the plan groups by inflow', () => {
    expect(toPayslipLine(makePayslipLine({ attracts_super: false }))).toEqual({
      kind: 'earning',
      sourceInflowId: 'i1',
      label: 'Ordinary Hours',
      amountCents: 5_000_00,
      attractsSuper: false,
    })
  })

  it('maps a tax row to the line the plan groups by component', () => {
    expect(
      toPayslipLine(
        makePayslipTaxLine({
          label: 'STSL Component',
          tax_component: 'stsl',
          amount_cents: 434_00,
        }),
      ),
    ).toEqual({
      kind: 'tax',
      component: 'stsl',
      label: 'STSL Component',
      amountCents: 434_00,
    })
  })
})

describe('payslipVarianceFor', () => {
  it('measures the slip against the inflow its lines draw on and the member’s estimate', () => {
    const payslip = makePayslip()
    const variance = payslipVarianceFor(
      payslip,
      payslipReconciliation([inflow], [makePayslipLine()]),
      memberEstimate,
      config,
    )

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
    expect(
      payslipVarianceFor(
        payslip,
        payslipReconciliation([inflow], [makePayslipLine()]),
        memberEstimate,
        config,
      ).actualSuperCents,
    ).toBe(700_00)
  })

  it('has no gross expectation when no line on the slip names an inflow', () => {
    const variance = payslipVarianceFor(
      makePayslip(),
      payslipReconciliation([inflow], [makePayslipLine({ source_inflow_id: null })]),
      memberEstimate,
      config,
    )
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.grossVarianceCents).toBeNull()
    expect(variance.cadenceInflowId).toBeNull()
    expect(variance.basis).toBe('calendar_days')
  })

  it('has no gross expectation when the inflow the lines drew on has been retired', () => {
    const variance = payslipVarianceFor(
      makePayslip(),
      payslipReconciliation([], [makePayslipLine()]),
      memberEstimate,
      config,
    )
    expect(variance.expectedGrossCents).toBeNull()
    expect(variance.basis).toBe('calendar_days')
  })

  it('expects nothing withheld for a member with no estimate', () => {
    const variance = payslipVarianceFor(
      makePayslip(),
      payslipReconciliation([inflow], [makePayslipLine()]),
      undefined,
      config,
    )
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
        attracts_super: false,
      }),
    ]
    const variance = payslipVarianceFor(
      payslip,
      payslipReconciliation([inflow, ON_CALL], lines),
      memberEstimate,
      config,
    )

    expect(variance.lineGroups).toEqual([
      {
        sourceInflowId: 'i1',
        labels: ['Ordinary Hours', 'Annual Leave'],
        actualCents: 5_000_00,
        expectedCents: 5_000_00,
        varianceCents: 0,
        basis: 'cadence',
        partCycleReason: null,
      },
      {
        sourceInflowId: 'i2',
        labels: ['On-call (T1)'],
        actualCents: 495_50,
        expectedCents: 450_00,
        varianceCents: 45_50,
        basis: 'cadence',
        partCycleReason: null,
      },
    ])
    expect(variance.unallocatedCents).toBe(0)
    expect(variance.expectedGrossCents).toBe(5_450_00)
  })

  // The employer pays super on the $5,000 salary, not on the $5,495.50 that
  // includes on-call: 12% of $5,495.50 is $659.46, which reads a correct slip as
  // $59.46 below plan.
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
        attracts_super: false,
      }),
    ]
    const variance = payslipVarianceFor(
      payslip,
      payslipReconciliation([inflow, ON_CALL], lines),
      memberEstimate,
      config,
    )

    expect(variance.superBaseCents).toBe(5_000_00)
    expect(variance.expectedSuperGuaranteeCents).toBe(600_00)
    expect(variance.superVarianceCents).toBe(0)
  })

  it('keeps the super base where the allowance the line drew on has been retired', () => {
    const payslip = makePayslip({ gross_cents: 5_495_50, super_cents: 600_00 })
    const lines = [
      makePayslipLine({ id: 'pl1', label: 'Ordinary Hours', amount_cents: 5_000_00 }),
      makePayslipLine({
        id: 'pl2',
        label: 'On-call (T1)',
        amount_cents: 495_50,
        source_inflow_id: null,
        attracts_super: false,
      }),
    ]
    // The inflow is gone and the line's link with it, but the line still records
    // that it earned no super, so the slip is measured as it always was.
    const variance = payslipVarianceFor(
      payslip,
      payslipReconciliation([inflow], lines),
      memberEstimate,
      config,
    )

    expect(variance.superBaseCents).toBe(5_000_00)
    expect(variance.superVarianceCents).toBe(0)
  })

  it('measures each tax line against the component of the liability it pays', () => {
    // The member's estimate carries a compulsory HELP repayment, so the STSL line
    // is held against the period's share of that and the PAYG line against the
    // rest of the liability — and the two together against the printed total.
    const payslip = makePayslip({ tax_withheld_cents: 1_850_00 })
    const lines = [
      makePayslipLine(),
      makePayslipTaxLine({ id: 'pt1', label: 'PAYG', amount_cents: 1_416_00 }),
      makePayslipTaxLine({
        id: 'pt2',
        label: 'STSL Component',
        tax_component: 'stsl',
        amount_cents: 434_00,
      }),
    ]
    const variance = payslipVarianceFor(
      payslip,
      payslipReconciliation([inflow], lines),
      withHelpDebt,
      config,
    )

    const help = withHelpDebt.breakdown.helpRepaymentCents
    expect(help).toBeGreaterThan(0)
    expect(variance.taxGroups.map((group) => group.component)).toEqual(['payg', 'stsl'])
    expect(variance.taxGroups[1]?.expectedCents).toBe(Math.round(help / 26))
    expect(variance.taxGroups[0]?.expectedCents).toBe(
      Math.round((withHelpDebt.annualTaxCents - help) / 26),
    )
    // The lines account for every dollar of the printed total, which is what the
    // year's withholding is summed from either way.
    expect(variance.unallocatedTaxCents).toBe(0)
  })
})

/** What the member's estimated liability withholds over one whole fortnight. */
const ON_PLAN_WITHHELD = Math.round(memberEstimate.annualTaxCents / 26)

/** The second fortnight of FY2027, itemised against the salary like the first. */
const SECOND_FORTNIGHT = {
  id: 'ps2',
  period_start: '2026-07-15',
  period_end: '2026-07-28',
  paid_on: '2026-07-29',
} as const

describe('payslipVariancesById', () => {
  it('keys one measurement per slip, the same one its card is given', () => {
    const payslips = [makePayslip(), makePayslip(SECOND_FORTNIGHT)]
    const reconciliation = payslipReconciliation(
      [inflow],
      [makePayslipLine(), makePayslipLine({ id: 'pl2', payslip_id: 'ps2' })],
    )
    const variances = payslipVariancesById(payslips, reconciliation, memberEstimate, config)

    expect([...variances.keys()]).toEqual(['ps1', 'ps2'])
    expect(variances.get('ps1')).toEqual(
      payslipVarianceFor(payslips[0]!, reconciliation, memberEstimate, config),
    )
  })
})

describe('payslipYearPositionsFromRows', () => {
  it('sums the year off the very measurements the cards read', () => {
    const payslips = [
      makePayslip({ tax_withheld_cents: ON_PLAN_WITHHELD }),
      makePayslip({ ...SECOND_FORTNIGHT, tax_withheld_cents: ON_PLAN_WITHHELD }),
    ]
    const reconciliation = payslipReconciliation(
      [inflow],
      [makePayslipLine(), makePayslipLine({ id: 'pl2', payslip_id: 'ps2' })],
    )
    const variances = payslipVariancesById(payslips, reconciliation, memberEstimate, config)
    const positions = payslipYearPositionsFromRows(payslips, variances)

    // Two fortnights matching the plan: the year matches it too.
    expect(positions.gross).toEqual({
      actualCents: 10_000_00,
      expectedCents: 10_000_00,
      varianceCents: 0,
      coveredCount: 2,
      payslipCount: 2,
    })
    expect(positions.taxWithheld.varianceCents).toBe(0)
    expect(positions.super.varianceCents).toBe(0)
  })

  it('leaves a slip with no gross expectation out of the gross position', () => {
    const payslips = [
      makePayslip(),
      // A $9,000 bonus slip drawing on no projection at all.
      makePayslip({ ...SECOND_FORTNIGHT, gross_cents: 9_000_00 }),
    ]
    const reconciliation = payslipReconciliation(
      [inflow],
      [
        makePayslipLine(),
        makePayslipLine({ id: 'pl2', payslip_id: 'ps2', source_inflow_id: null }),
      ],
    )
    const positions = payslipYearPositionsFromRows(
      payslips,
      payslipVariancesById(payslips, reconciliation, memberEstimate, config),
    )

    expect(positions.gross.coveredCount).toBe(1)
    expect(positions.gross.payslipCount).toBe(2)
    // The bonus is neither above plan nor part of the expectation.
    expect(positions.gross.varianceCents).toBe(0)
    expect(positions.gross.expectedCents).toBe(5_000_00)
    // Withholding is apportioned even with nothing mapped, so it covers both.
    expect(positions.taxWithheld.coveredCount).toBe(2)
  })

  it('covers nothing for a member with no slips', () => {
    expect(payslipYearPositionsFromRows([], new Map()).gross).toEqual({
      actualCents: 0,
      expectedCents: null,
      varianceCents: null,
      coveredCount: 0,
      payslipCount: 0,
    })
  })

  it('takes no account of a slip that was never measured', () => {
    const measured = makePayslip()
    const reconciliation = payslipReconciliation([inflow], [makePayslipLine()])
    const positions = payslipYearPositionsFromRows(
      [measured, makePayslip(SECOND_FORTNIGHT)],
      payslipVariancesById([measured], reconciliation, memberEstimate, config),
    )

    expect(positions.gross.payslipCount).toBe(1)
    expect(positions.gross.actualCents).toBe(5_000_00)
  })
})
