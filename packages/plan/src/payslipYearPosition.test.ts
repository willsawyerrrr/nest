import { describe, expect, it } from 'vitest'
import {
  payslipVariance,
  payslipYearPositions,
  type Money,
  type PayslipActuals,
  type PayslipEarningLine,
  type PayslipExpectation,
  type PayslipPositionRow,
  type ReconciledInflow,
  type SuperGuaranteeConfig,
} from './index.ts'

/** FY2027 — 1 Jul 2026 – 30 Jun 2027. */
const FY = 2027

/** A $130,000 salary paid fortnightly — $5,000 a period. */
const SALARY: ReconciledInflow = { type: 'salary', schedule: 'fortnightly', amountCents: 5_000_00 }

const SUPER_CONFIG: SuperGuaranteeConfig = { guaranteeRate: 0.12 }

/** $36,400 a year — $1,400.00 a fortnight, exactly. */
const ANNUAL_TAX = 36_400_00

/** $130,000 ÷ 26. */
const CADENCE_GROSS = 5_000_00

/** $36,400 ÷ 26. */
const CADENCE_WITHHELD = 1_400_00

/** 12% of $5,000. */
const CADENCE_SUPER = 600_00

/** The first three fortnights of FY2027, each one whole turn of the cadence. */
const FORTNIGHTS = [
  { periodStart: '2026-07-01', periodEnd: '2026-07-14' },
  { periodStart: '2026-07-15', periodEnd: '2026-07-28' },
  { periodStart: '2026-07-29', periodEnd: '2026-08-11' },
] as const

function salaryLine(amountCents: Money): PayslipEarningLine {
  return { kind: 'earning', sourceInflowId: 'salary', label: 'Ordinary Hours', amountCents }
}

/** A line drawing on nothing, which leaves its slip no gross to expect. */
function unmappedLine(amountCents: Money): PayslipEarningLine {
  return { kind: 'earning', sourceInflowId: null, label: 'Bonus', amountCents }
}

const EXPECTATION: PayslipExpectation = {
  inflowsById: new Map([['salary', SALARY]]),
  annualTaxCents: ANNUAL_TAX,
  superConfig: SUPER_CONFIG,
}

/**
 * One fortnight of the year, exactly on plan before any override, measured the
 * way its own card is measured. The year is summed from these, so a test that
 * overrides a figure moves the year by exactly what it moved the slip by.
 */
function measured(index: number, overrides: Partial<PayslipActuals> = {}): PayslipPositionRow {
  const slip: PayslipActuals = {
    financialYear: FY,
    ...FORTNIGHTS[index]!,
    grossCents: CADENCE_GROSS,
    taxWithheldCents: CADENCE_WITHHELD,
    superCents: CADENCE_SUPER,
    ...overrides,
  }
  const lines = overrides.lines ?? [salaryLine(slip.grossCents)]
  return {
    grossCents: slip.grossCents,
    taxWithheldCents: slip.taxWithheldCents,
    variance: payslipVariance({ ...slip, lines }, EXPECTATION),
  }
}

describe('payslipYearPositions', () => {
  it('reads a year of slips all on plan as on plan', () => {
    const positions = payslipYearPositions([measured(0), measured(1), measured(2)])

    expect(positions.gross).toEqual({
      actualCents: 3 * CADENCE_GROSS,
      expectedCents: 3 * CADENCE_GROSS,
      varianceCents: 0,
      coveredCount: 3,
      payslipCount: 3,
    })
    expect(positions.taxWithheld.varianceCents).toBe(0)
    expect(positions.taxWithheld.expectedCents).toBe(3 * CADENCE_WITHHELD)
    expect(positions.super.varianceCents).toBe(0)
    expect(positions.super.expectedCents).toBe(3 * CADENCE_SUPER)
  })

  it('nets a fortnight above plan against one below', () => {
    const positions = payslipYearPositions([
      measured(0, { grossCents: 5_500_00, taxWithheldCents: 1_500_00 }),
      measured(1, { grossCents: 4_800_00, taxWithheldCents: 1_360_00 }),
    ])

    // $500 over then $200 under is $300 over the fortnight pair, not $700 of movement.
    expect(positions.gross.varianceCents).toBe(300_00)
    expect(positions.taxWithheld.varianceCents).toBe(60_00)
  })

  it('counts salary sacrifice in the year’s super, as a slip’s own figure does', () => {
    const positions = payslipYearPositions([
      measured(0, { superCents: 500_00, salarySacrificeCents: 100_00 }),
    ])

    expect(positions.super.actualCents).toBe(CADENCE_SUPER)
    expect(positions.super.varianceCents).toBe(0)
  })

  it('covers only the slips carrying an expectation, and counts how many', () => {
    // A $9,000 bonus slip mapped to no projection: three times the plan, and yet
    // nothing about it is above or below plan.
    const rows = [
      measured(0),
      measured(1, { grossCents: 9_000_00, lines: [unmappedLine(9_000_00)] }),
    ]
    const positions = payslipYearPositions(rows)

    expect(positions.gross).toEqual({
      actualCents: CADENCE_GROSS,
      expectedCents: CADENCE_GROSS,
      varianceCents: 0,
      coveredCount: 1,
      payslipCount: 2,
    })
    // The uncovered slip's gross is left out of both sides rather than held
    // against nil, which would have read its whole $9,000 as a surplus.
    expect(positions.gross.varianceCents).not.toBe(9_000_00)
    // Withholding is apportioned for a slip mapped to nothing, so it covers both.
    expect(positions.taxWithheld.coveredCount).toBe(2)
    expect(positions.taxWithheld.expectedCents).toBe(
      rows[0]!.variance.expectedTaxWithheldCents + rows[1]!.variance.expectedTaxWithheldCents,
    )
  })

  it('has nothing to compare where no slip carries an expectation', () => {
    const positions = payslipYearPositions([
      measured(0, { lines: [unmappedLine(CADENCE_GROSS)] }),
      measured(1, { lines: [unmappedLine(CADENCE_GROSS)] }),
    ])

    expect(positions.gross).toEqual({
      actualCents: 0,
      expectedCents: null,
      varianceCents: null,
      coveredCount: 0,
      payslipCount: 2,
    })
  })

  it('covers nothing for a year with no slips', () => {
    const positions = payslipYearPositions([])

    for (const position of [positions.gross, positions.taxWithheld, positions.super]) {
      expect(position).toEqual({
        actualCents: 0,
        expectedCents: null,
        varianceCents: null,
        coveredCount: 0,
        payslipCount: 0,
      })
    }
  })

  it('agrees with the per-slip figures it sums', () => {
    const rows = [
      measured(0, { grossCents: 5_500_00, taxWithheldCents: 1_500_00, superCents: 640_00 }),
      measured(1, { grossCents: 4_800_00, taxWithheldCents: 1_360_00 }),
      measured(2, { superCents: 550_00, salarySacrificeCents: 20_00 }),
    ]
    const positions = payslipYearPositions(rows)
    const sum = (amounts: readonly (Money | null)[]) =>
      amounts.reduce<Money>((total, amount) => total + (amount ?? 0), 0)

    expect(positions.gross.varianceCents).toBe(
      sum(rows.map((row) => row.variance.grossVarianceCents)),
    )
    expect(positions.taxWithheld.varianceCents).toBe(
      sum(rows.map((row) => row.variance.taxWithheldVarianceCents)),
    )
    expect(positions.super.varianceCents).toBe(
      sum(rows.map((row) => row.variance.superVarianceCents)),
    )
    expect(positions.super.actualCents).toBe(sum(rows.map((row) => row.variance.actualSuperCents)))
  })
})
