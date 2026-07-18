import { describe, expect, it } from 'vitest'
import {
  computeTax,
  configsByYear,
  financialYearForDate,
  FY2027_CONFIG,
  helpRepayment,
  incomeTax,
  lowIncomeTaxOffset,
  medicareLevy,
  medicareLevySurcharge,
  taxableIncome,
} from './index'
import type { AssessableIncome, TaxInput, TaxYearConfig } from './index'

/**
 * FIXTURE — deliberately round, made-up figures, NOT official ATO rates or
 * thresholds. Real per-financial-year configs are sourced from the ATO and
 * loaded separately. These values exist only to exercise the engine's arithmetic
 * across every band edge and phase-in.
 */
const FIXTURE_CONFIG: TaxYearConfig = {
  financialYear: 2027,
  residency: 'resident',
  brackets: [
    { upToCents: 1_800_000, rate: 0.0 },
    { upToCents: 4_500_000, rate: 0.15 },
    { upToCents: 12_000_000, rate: 0.3 },
    { upToCents: 18_000_000, rate: 0.4 },
    { upToCents: null, rate: 0.5 },
  ],
  medicareLevy: {
    rate: 0.02,
    lowIncomeThresholdCents: 2_400_000,
    phaseInRate: 0.1,
  },
  medicareLevySurcharge: {
    tiers: [
      { incomeOverCents: 9_000_000, familyIncomeOverCents: 18_000_000, rate: 0.01 },
      { incomeOverCents: 10_500_000, familyIncomeOverCents: 21_000_000, rate: 0.0125 },
      { incomeOverCents: 14_000_000, familyIncomeOverCents: 28_000_000, rate: 0.015 },
    ],
    familyDependentChildIncrementCents: 150_000,
  },
  lito: {
    maxOffsetCents: 70_000,
    taperRules: [
      { incomeOverCents: 3_750_000, reductionPerDollar: 0.04 },
      { incomeOverCents: 4_500_000, reductionPerDollar: 0.01 },
    ],
  },
  helpRepayment: {
    marginalBands: [
      { incomeOverCents: 5_000_000, rate: 0.1 },
      { incomeOverCents: 8_000_000, rate: 0.3 },
    ],
    maxRepaymentRate: 0.15,
  },
  superGuaranteeRate: 0.12,
}

const NO_INCOME: AssessableIncome = {
  salaryOrWagesCents: 0,
  businessCents: 0,
  investmentCents: 0,
  otherCents: 0,
}

/** Builds a `TaxInput` with a single salary figure and sensible defaults. */
function inputForSalary(salaryCents: number, overrides: Partial<TaxInput> = {}): TaxInput {
  return {
    assessableIncome: { ...NO_INCOME, salaryOrWagesCents: salaryCents },
    deductionsCents: 0,
    residency: 'resident',
    privateHospitalCover: false,
    helpDebtCents: 0,
    paygWithheldCents: 0,
    ...overrides,
  }
}

describe('financialYearForDate', () => {
  it('labels 1 July as the start of the new financial year', () => {
    expect(financialYearForDate(new Date('2026-07-01T00:00:00Z'))).toBe(2027)
  })

  it('labels 30 June as the end of the current financial year', () => {
    expect(financialYearForDate(new Date('2026-06-30T00:00:00Z'))).toBe(2026)
  })

  it('labels dates either side of the calendar new year', () => {
    expect(financialYearForDate(new Date('2026-12-31T00:00:00Z'))).toBe(2027)
    expect(financialYearForDate(new Date('2026-01-01T00:00:00Z'))).toBe(2026)
  })
})

describe('taxableIncome', () => {
  it('sums assessable components then subtracts deductions', () => {
    const input: TaxInput = {
      assessableIncome: {
        salaryOrWagesCents: 8_000_000,
        businessCents: 1_000_000,
        investmentCents: 500_000,
        otherCents: 500_000,
      },
      deductionsCents: 1_000_000,
      residency: 'resident',
      privateHospitalCover: false,
      helpDebtCents: 0,
      paygWithheldCents: 0,
    }
    expect(taxableIncome(input)).toBe(9_000_000)
  })

  it('floors at zero when deductions exceed assessable income', () => {
    expect(taxableIncome(inputForSalary(1_000_000, { deductionsCents: 1_500_000 }))).toBe(0)
  })
})

describe('incomeTax', () => {
  it('charges nothing below the tax-free threshold', () => {
    expect(incomeTax(1_500_000, FIXTURE_CONFIG)).toBe(0)
  })

  it('charges nothing exactly at the tax-free threshold', () => {
    expect(incomeTax(1_800_000, FIXTURE_CONFIG)).toBe(0)
  })

  it('applies each bracket at its upper edge', () => {
    // 0 + (4,500,000 − 1,800,000) × 0.15
    expect(incomeTax(4_500_000, FIXTURE_CONFIG)).toBe(405_000)
    // + (12,000,000 − 4,500,000) × 0.30
    expect(incomeTax(12_000_000, FIXTURE_CONFIG)).toBe(2_655_000)
    // + (18,000,000 − 12,000,000) × 0.40
    expect(incomeTax(18_000_000, FIXTURE_CONFIG)).toBe(5_055_000)
    // + (20,000,000 − 18,000,000) × 0.50
    expect(incomeTax(20_000_000, FIXTURE_CONFIG)).toBe(6_055_000)
  })

  it('applies the marginal rate part-way through a bracket', () => {
    // 405,000 + (5,000,000 − 4,500,000) × 0.30
    expect(incomeTax(5_000_000, FIXTURE_CONFIG)).toBe(555_000)
  })
})

describe('lowIncomeTaxOffset', () => {
  it('gives the full offset below the first taper threshold', () => {
    expect(lowIncomeTaxOffset(1_500_000, FIXTURE_CONFIG)).toBe(70_000)
  })

  it('tapers within the first band', () => {
    // 70,000 − 0.04 × (4,000,000 − 3,750,000)
    expect(lowIncomeTaxOffset(4_000_000, FIXTURE_CONFIG)).toBe(60_000)
  })

  it('tapers across both bands', () => {
    // 70,000 − [0.04 × (4,500,000 − 3,750,000) + 0.01 × (6,000,000 − 4,500,000)]
    expect(lowIncomeTaxOffset(6_000_000, FIXTURE_CONFIG)).toBe(25_000)
  })

  it('floors at zero once fully tapered', () => {
    expect(lowIncomeTaxOffset(9_000_000, FIXTURE_CONFIG)).toBe(0)
  })
})

describe('medicareLevy', () => {
  it('charges nothing at or below the low-income threshold', () => {
    expect(medicareLevy(2_400_000, FIXTURE_CONFIG)).toBe(0)
  })

  it('phases in above the threshold', () => {
    // min(0.02 × 2,700,000, 0.10 × (2,700,000 − 2,400,000)) = min(54,000, 30,000)
    expect(medicareLevy(2_700_000, FIXTURE_CONFIG)).toBe(30_000)
  })

  it('reaches the full rate at the phase-in ceiling', () => {
    // 0.02 × 3,000,000 == 0.10 × (3,000,000 − 2,400,000) == 60,000
    expect(medicareLevy(3_000_000, FIXTURE_CONFIG)).toBe(60_000)
  })

  it('charges the full rate well above the ceiling', () => {
    expect(medicareLevy(4_000_000, FIXTURE_CONFIG)).toBe(80_000)
  })
})

describe('medicareLevySurcharge', () => {
  it('is exempt with private hospital cover', () => {
    expect(medicareLevySurcharge(15_000_000, true, FIXTURE_CONFIG)).toBe(0)
  })

  it('charges nothing below the first tier', () => {
    expect(medicareLevySurcharge(8_000_000, false, FIXTURE_CONFIG)).toBe(0)
  })

  it('applies the first tier rate to the whole income', () => {
    expect(medicareLevySurcharge(10_000_000, false, FIXTURE_CONFIG)).toBe(100_000)
  })

  it('applies the second tier rate', () => {
    expect(medicareLevySurcharge(11_000_000, false, FIXTURE_CONFIG)).toBe(137_500)
  })

  it('applies the top tier rate', () => {
    expect(medicareLevySurcharge(15_000_000, false, FIXTURE_CONFIG)).toBe(225_000)
  })
})

describe('helpRepayment', () => {
  it('charges nothing at or below the first band floor', () => {
    expect(helpRepayment(4_000_000, 5_000_000, FIXTURE_CONFIG)).toBe(0)
    expect(helpRepayment(5_000_000, 5_000_000, FIXTURE_CONFIG)).toBe(0)
  })

  it('charges the marginal rate only on income above the floor', () => {
    // 0.10 × (6,000,000 − 5,000,000)
    expect(helpRepayment(6_000_000, 5_000_000, FIXTURE_CONFIG)).toBe(100_000)
  })

  it('accumulates marginal rates across bands', () => {
    // 0.10 × (8,000,000 − 5,000,000) + 0.30 × (9,000,000 − 8,000,000)
    expect(helpRepayment(9_000_000, 5_000_000, FIXTURE_CONFIG)).toBe(600_000)
  })

  it('caps the repayment at the maximum rate of whole income', () => {
    // marginal = 0.10 × 3,000,000 + 0.30 × 12,000,000 = 3,900,000;
    // cap = 0.15 × 20,000,000 = 3,000,000, which binds.
    expect(helpRepayment(20_000_000, 5_000_000, FIXTURE_CONFIG)).toBe(3_000_000)
  })

  it('caps the repayment at the outstanding debt', () => {
    expect(helpRepayment(20_000_000, 50_000, FIXTURE_CONFIG)).toBe(50_000)
  })
})

describe('computeTax', () => {
  it('returns a zero liability and a refund below the tax-free threshold', () => {
    const result = computeTax(
      inputForSalary(1_500_000, { paygWithheldCents: 100_000 }),
      FIXTURE_CONFIG,
    )
    expect(result).toEqual({
      taxableIncomeCents: 1_500_000,
      incomeTaxCents: 0,
      litoOffsetCents: 70_000,
      medicareLevyCents: 0,
      medicareLevySurchargeCents: 0,
      helpRepaymentCents: 0,
      totalLiabilityCents: 0,
      paygWithheldCents: 100_000,
      balanceCents: -100_000,
    })
  })

  it('never lets the offset push net income tax below zero', () => {
    // Gross income tax 30,000 < LITO 70,000, so net income tax is floored at 0.
    const result = computeTax(inputForSalary(2_000_000), FIXTURE_CONFIG)
    expect(result.incomeTaxCents).toBe(30_000)
    expect(result.litoOffsetCents).toBe(70_000)
    expect(result.totalLiabilityCents).toBe(0)
  })

  it('computes an amount owing for a high earner with HELP debt', () => {
    const result = computeTax(
      inputForSalary(10_000_000, { helpDebtCents: 2_000_000, paygWithheldCents: 2_000_000 }),
      FIXTURE_CONFIG,
    )
    expect(result).toEqual({
      taxableIncomeCents: 10_000_000,
      incomeTaxCents: 2_055_000,
      litoOffsetCents: 0,
      medicareLevyCents: 200_000,
      medicareLevySurchargeCents: 100_000,
      // marginal: 0.10 × (8,000,000 − 5,000,000) + 0.30 × (10,000,000 − 8,000,000)
      helpRepaymentCents: 900_000,
      totalLiabilityCents: 3_255_000,
      paygWithheldCents: 2_000_000,
      balanceCents: 1_255_000,
    })
  })

  it('computes an estimated refund with private cover and taper relief', () => {
    const result = computeTax(
      inputForSalary(4_000_000, { privateHospitalCover: true, paygWithheldCents: 700_000 }),
      FIXTURE_CONFIG,
    )
    expect(result).toEqual({
      taxableIncomeCents: 4_000_000,
      incomeTaxCents: 330_000,
      litoOffsetCents: 60_000,
      medicareLevyCents: 80_000,
      medicareLevySurchargeCents: 0,
      helpRepaymentCents: 0,
      totalLiabilityCents: 350_000,
      paygWithheldCents: 700_000,
      balanceCents: -350_000,
    })
  })
})

/**
 * Sanity checks against the verified FY2027 config (real ATO figures). These
 * assert known income points reproduce the ATO's published rules — not just the
 * engine's arithmetic. See packages/tax/src/configs.ts for sources.
 */
describe('FY2027_CONFIG', () => {
  it('is registered in configsByYear', () => {
    expect(configsByYear[2027]).toBe(FY2027_CONFIG)
    expect(FY2027_CONFIG.financialYear).toBe(2027)
    expect(FY2027_CONFIG.residency).toBe('resident')
  })

  it('charges no tax below the tax-free threshold', () => {
    const result = computeTax(inputForSalary(1_500_000), FY2027_CONFIG)
    expect(result.taxableIncomeCents).toBe(1_500_000)
    expect(result.incomeTaxCents).toBe(0)
    expect(result.medicareLevyCents).toBe(0)
    expect(result.totalLiabilityCents).toBe(0)
  })

  it('applies the 15% lowest rate from 1 July 2026', () => {
    // Tax at $45,000 = 15c per $1 over $18,200 = 0.15 × 26,800 = $4,020.
    expect(incomeTax(4_500_000, FY2027_CONFIG)).toBe(402_000)
    // Tax at $190,000 = $51,370 (the 2025-26 $51,638 less 1% of $26,800).
    expect(incomeTax(19_000_000, FY2027_CONFIG)).toBe(5_137_000)
  })

  it('computes a mid-bracket earner with HELP debt and private cover', () => {
    const result = computeTax(
      inputForSalary(8_000_000, { privateHospitalCover: true, helpDebtCents: 3_000_000 }),
      FY2027_CONFIG,
    )
    expect(result.incomeTaxCents).toBe(1_452_000)
    expect(result.medicareLevyCents).toBe(160_000)
    expect(result.medicareLevySurchargeCents).toBe(0) // private cover exempts
    // Marginal HELP: 15c per $1 over $69,528 = 0.15 × $10,472 = $1,570.80.
    expect(result.helpRepaymentCents).toBe(157_080)
    expect(result.totalLiabilityCents).toBe(1_769_080)
  })

  it('applies the top surcharge tier to a high earner without cover', () => {
    const withoutCover = computeTax(inputForSalary(20_000_000), FY2027_CONFIG)
    expect(withoutCover.medicareLevySurchargeCents).toBe(300_000) // 1.5% × $200,000
    const withCover = computeTax(
      inputForSalary(20_000_000, { privateHospitalCover: true }),
      FY2027_CONFIG,
    )
    expect(withCover.medicareLevySurchargeCents).toBe(0)
  })

  it('caps HELP at 10% of repayment income for very high earners', () => {
    // $250,000: marginal exceeds the 10% cap, so repayment = 10% × $250,000.
    expect(helpRepayment(25_000_000, 5_000_000_00, FY2027_CONFIG)).toBe(2_500_000)
  })

  it('gives the maximum LITO below the first taper threshold', () => {
    expect(lowIncomeTaxOffset(3_000_000, FY2027_CONFIG)).toBe(70_000)
    expect(lowIncomeTaxOffset(6_666_700, FY2027_CONFIG)).toBe(0) // cuts out at $66,667
  })
})
