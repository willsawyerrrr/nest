import { describe, expect, it } from 'vitest'
import {
  activeFractionOfFinancialYear,
  carExpenseDeductionCents,
  computeTax,
  configsByYear,
  division293,
  familyMedicareLevySurcharge,
  financialYearBounds,
  financialYearForDate,
  FY2026_CONFIG,
  FY2027_CONFIG,
  helpRepayment,
  incomeTax,
  isDateInFinancialYear,
  lowIncomeTaxOffset,
  medicareLevy,
  medicareLevySurcharge,
  oneOffConcessionOffset,
  projectHelpPayoff,
  salarySacrificeWhatIf,
  splitOneOffPayment,
  superCoContribution,
  taxableIncome,
  type AssessableIncome,
  type TaxInput,
  type TaxYearConfig,
} from './index'

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
    { upToCents: 18_000_00, rate: 0.0 },
    { upToCents: 45_000_00, rate: 0.15 },
    { upToCents: 120_000_00, rate: 0.3 },
    { upToCents: 180_000_00, rate: 0.4 },
    { upToCents: null, rate: 0.5 },
  ],
  medicareLevy: {
    rate: 0.02,
    lowIncomeThresholdCents: 24_000_00,
    phaseInRate: 0.1,
  },
  medicareLevySurcharge: {
    tiers: [
      { incomeOverCents: 90_000_00, familyIncomeOverCents: 180_000_00, rate: 0.01 },
      { incomeOverCents: 105_000_00, familyIncomeOverCents: 210_000_00, rate: 0.0125 },
      { incomeOverCents: 140_000_00, familyIncomeOverCents: 280_000_00, rate: 0.015 },
    ],
    familyDependentChildIncrementCents: 1_500_00,
  },
  lito: {
    maxOffsetCents: 700_00,
    taperRules: [
      { incomeOverCents: 37_500_00, reductionPerDollar: 0.04 },
      { incomeOverCents: 45_000_00, reductionPerDollar: 0.01 },
    ],
  },
  helpRepayment: {
    marginalBands: [
      { incomeOverCents: 50_000_00, rate: 0.1 },
      { incomeOverCents: 80_000_00, rate: 0.3 },
    ],
    maxRepaymentRate: 0.15,
    indexationRate: 0.04,
  },
  // Round, made-up super figures (a low $150,000 Division 293 threshold so the
  // fixture can exercise it without needing a huge income).
  super: {
    guaranteeRate: 0.12,
    concessionalCapCents: 30_000_00,
    contributionsTaxRate: 0.15,
    nonConcessionalCapCents: 120_000_00,
    division293ThresholdCents: 150_000_00,
    division293Rate: 0.15,
    carryForwardBalanceCapCents: 500_000_00,
    generalTransferBalanceCapCents: 1_900_000_00,
    coContribution: {
      maxCents: 500_00,
      lowerIncomeThresholdCents: 45_000_00,
      higherIncomeThresholdCents: 60_000_00,
    },
    preservationAge: 60,
  },
  // Round, made-up termination figures. Every rate is deliberately distinct so a
  // test proves WHICH rate was read: 30% below preservation age, 15% at it, and a
  // 25% unused-leave maximum that matches neither.
  employmentTermination: {
    capCents: 200_000_00,
    wholeOfIncomeCapCents: 150_000_00,
    belowPreservationAgeRate: 0.3,
    atPreservationAgeRate: 0.15,
    aboveCapRate: 0.45,
    unusedLeaveMaxRate: 0.25,
    genuineRedundancy: {
      baseLimitCents: 12_000_00,
      perYearOfServiceCents: 6_000_00,
    },
  },
  carExpense: {
    centsPerKm: 90,
    maxClaimableKm: 5_000,
  },
}

const NO_INCOME: AssessableIncome = {
  salaryOrWagesCents: 0,
  businessCents: 0,
  investmentCents: 0,
  otherCents: 0,
  employmentTerminationCents: 0,
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

describe('financialYearBounds', () => {
  it('spans 1 July of the prior year to 30 June of the label year, in UTC', () => {
    const { start, end } = financialYearBounds(2027)
    expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2027-06-30T00:00:00.000Z')
  })
})

describe('activeFractionOfFinancialYear', () => {
  it('returns 1 when both dates are absent (applies all year)', () => {
    expect(activeFractionOfFinancialYear(undefined, undefined, 2027)).toBe(1)
  })

  it('returns 1 for a window covering the whole financial year', () => {
    expect(activeFractionOfFinancialYear('2026-07-01', '2027-06-30', 2027)).toBe(1)
  })

  it('clamps a window overhanging the financial year on both sides to 1', () => {
    expect(activeFractionOfFinancialYear('2025-01-01', '2030-01-01', 2027)).toBe(1)
  })

  it('returns exactly a half for the first half of a leap financial year', () => {
    // FY2028 (1 Jul 2027 – 30 Jun 2028) is 366 days; 1 Jul–30 Dec 2027 is 183 days.
    expect(activeFractionOfFinancialYear('2027-07-01', '2027-12-30', 2028)).toBe(0.5)
  })

  it('returns 0 when the window falls entirely outside the financial year', () => {
    expect(activeFractionOfFinancialYear('2028-01-01', '2028-02-01', 2027)).toBe(0)
  })

  it('sums adjacent windows (a pay rise) to the whole financial year', () => {
    const before = activeFractionOfFinancialYear(undefined, '2026-09-14', 2027)
    const after = activeFractionOfFinancialYear('2026-09-15', undefined, 2027)
    expect(before).toBeCloseTo(76 / 365, 12)
    expect(after).toBeCloseTo(289 / 365, 12)
    expect(before + after).toBeCloseTo(1, 12)
  })
})

describe('taxableIncome', () => {
  it('sums assessable components then subtracts deductions', () => {
    const input: TaxInput = {
      assessableIncome: {
        salaryOrWagesCents: 80_000_00,
        businessCents: 10_000_00,
        investmentCents: 5_000_00,
        otherCents: 5_000_00,
        employmentTerminationCents: 20_000_00,
      },
      deductionsCents: 10_000_00,
      residency: 'resident',
      privateHospitalCover: false,
      helpDebtCents: 0,
      paygWithheldCents: 0,
    }
    expect(taxableIncome(input)).toBe(110_000_00)
  })

  it('floors at zero when deductions exceed assessable income', () => {
    expect(taxableIncome(inputForSalary(10_000_00, { deductionsCents: 15_000_00 }))).toBe(0)
  })
})

describe('incomeTax', () => {
  it('charges nothing below the tax-free threshold', () => {
    expect(incomeTax(15_000_00, FIXTURE_CONFIG)).toBe(0)
  })

  it('charges nothing exactly at the tax-free threshold', () => {
    expect(incomeTax(18_000_00, FIXTURE_CONFIG)).toBe(0)
  })

  it('applies each bracket at its upper edge', () => {
    // 0 + (4,500,000 − 1,800,000) × 0.15
    expect(incomeTax(45_000_00, FIXTURE_CONFIG)).toBe(4_050_00)
    // + (12,000,000 − 4,500,000) × 0.30
    expect(incomeTax(120_000_00, FIXTURE_CONFIG)).toBe(26_550_00)
    // + (18,000,000 − 12,000,000) × 0.40
    expect(incomeTax(180_000_00, FIXTURE_CONFIG)).toBe(50_550_00)
    // + (20,000,000 − 18,000,000) × 0.50
    expect(incomeTax(200_000_00, FIXTURE_CONFIG)).toBe(60_550_00)
  })

  it('applies the marginal rate part-way through a bracket', () => {
    // 405,000 + (5,000,000 − 4,500,000) × 0.30
    expect(incomeTax(50_000_00, FIXTURE_CONFIG)).toBe(5_550_00)
  })
})

describe('lowIncomeTaxOffset', () => {
  it('gives the full offset below the first taper threshold', () => {
    expect(lowIncomeTaxOffset(15_000_00, FIXTURE_CONFIG)).toBe(700_00)
  })

  it('tapers within the first band', () => {
    // 70,000 − 0.04 × (4,000,000 − 3,750,000)
    expect(lowIncomeTaxOffset(40_000_00, FIXTURE_CONFIG)).toBe(600_00)
  })

  it('tapers across both bands', () => {
    // 70,000 − [0.04 × (4,500,000 − 3,750,000) + 0.01 × (6,000,000 − 4,500,000)]
    expect(lowIncomeTaxOffset(60_000_00, FIXTURE_CONFIG)).toBe(250_00)
  })

  it('floors at zero once fully tapered', () => {
    expect(lowIncomeTaxOffset(90_000_00, FIXTURE_CONFIG)).toBe(0)
  })
})

describe('medicareLevy', () => {
  it('charges nothing at or below the low-income threshold', () => {
    expect(medicareLevy(24_000_00, FIXTURE_CONFIG)).toBe(0)
  })

  it('phases in above the threshold', () => {
    // min(0.02 × 2,700,000, 0.10 × (2,700,000 − 2,400,000)) = min(54,000, 30,000)
    expect(medicareLevy(27_000_00, FIXTURE_CONFIG)).toBe(300_00)
  })

  it('reaches the full rate at the phase-in ceiling', () => {
    // 0.02 × 3,000,000 == 0.10 × (3,000,000 − 2,400,000) == 60,000
    expect(medicareLevy(30_000_00, FIXTURE_CONFIG)).toBe(600_00)
  })

  it('charges the full rate well above the ceiling', () => {
    expect(medicareLevy(40_000_00, FIXTURE_CONFIG)).toBe(800_00)
  })
})

describe('medicareLevySurcharge', () => {
  it('is exempt with private hospital cover', () => {
    expect(medicareLevySurcharge(150_000_00, true, FIXTURE_CONFIG)).toBe(0)
  })

  it('charges nothing below the first tier', () => {
    expect(medicareLevySurcharge(80_000_00, false, FIXTURE_CONFIG)).toBe(0)
  })

  it('applies the first tier rate to the whole income', () => {
    expect(medicareLevySurcharge(100_000_00, false, FIXTURE_CONFIG)).toBe(1_000_00)
  })

  it('applies the second tier rate', () => {
    expect(medicareLevySurcharge(110_000_00, false, FIXTURE_CONFIG)).toBe(1_375_00)
  })

  it('applies the top tier rate', () => {
    expect(medicareLevySurcharge(150_000_00, false, FIXTURE_CONFIG)).toBe(2_250_00)
  })
})

describe('familyMedicareLevySurcharge', () => {
  const cover = (incomeForSurchargeCents: number) => ({
    incomeForSurchargeCents,
    hasPrivateHospitalCover: true,
  })
  const noCover = (incomeForSurchargeCents: number) => ({
    incomeForSurchargeCents,
    hasPrivateHospitalCover: false,
  })

  it('charges nothing when combined income is at or below the lowest family floor', () => {
    // 80,000 + 80,000 = 160,000 ≤ the 180,000 family floor.
    const result = familyMedicareLevySurcharge(
      [noCover(80_000_00), noCover(80_000_00)],
      0,
      FIXTURE_CONFIG,
    )
    expect(result.tierRate).toBe(0)
    expect(result.totalSurchargeCents).toBe(0)
    expect(result.combinedIncomeForSurchargeCents).toBe(160_000_00)
  })

  it('applies the family-selected rate to each member’s own income above a family floor', () => {
    // 120,000 + 100,000 = 220,000 → over the 210,000 floor → 1.25% tier.
    const result = familyMedicareLevySurcharge(
      [noCover(120_000_00), noCover(100_000_00)],
      0,
      FIXTURE_CONFIG,
    )
    expect(result.tierRate).toBe(0.0125)
    expect(result.thresholdCents).toBe(210_000_00)
    expect(result.perMemberSurchargeCents).toEqual([1_500_00, 1_250_00])
    expect(result.totalSurchargeCents).toBe(2_750_00)
  })

  it('raises the family floor per dependent child after the first', () => {
    const members = [noCover(100_000_00), noCover(81_000_00)] // combined 181,000
    // Just over the 180,000 floor with no children.
    expect(familyMedicareLevySurcharge(members, 0, FIXTURE_CONFIG).tierRate).toBe(0.01)
    // Two children add one increment (+1,500), lifting the floor to 181,500 > 181,000.
    const withChildren = familyMedicareLevySurcharge(members, 2, FIXTURE_CONFIG)
    expect(withChildren.tierRate).toBe(0)
    expect(withChildren.totalSurchargeCents).toBe(0)
  })

  it('excludes a covered member but still charges the other at the family rate', () => {
    // 150,000 + 120,000 = 270,000 → over the 210,000 floor → 1.25% tier.
    const result = familyMedicareLevySurcharge(
      [cover(150_000_00), noCover(120_000_00)],
      0,
      FIXTURE_CONFIG,
    )
    expect(result.tierRate).toBe(0.0125)
    expect(result.perMemberSurchargeCents).toEqual([0, 1_500_00])
    expect(result.totalSurchargeCents).toBe(1_500_00)
  })

  it('falls back to the single-person floors for a lone member with no children', () => {
    // 100,000 is over the 90,000 single floor (1%) but under the 180,000 family floor.
    const result = familyMedicareLevySurcharge([noCover(100_000_00)], 0, FIXTURE_CONFIG)
    expect(result.tierRate).toBe(0.01)
    expect(result.thresholdCents).toBe(90_000_00)
    expect(result.totalSurchargeCents).toBe(1_000_00)
  })

  it('reports a nil threshold and charges nothing when the config has no tiers', () => {
    const noTiers: TaxYearConfig = {
      ...FIXTURE_CONFIG,
      medicareLevySurcharge: { ...FIXTURE_CONFIG.medicareLevySurcharge, tiers: [] },
    }
    const result = familyMedicareLevySurcharge(
      [noCover(200_000_00), noCover(200_000_00)],
      0,
      noTiers,
    )
    expect(result.tierRate).toBe(0)
    expect(result.thresholdCents).toBe(0)
    expect(result.perMemberSurchargeCents).toEqual([0, 0])
    expect(result.totalSurchargeCents).toBe(0)
  })
})

describe('helpRepayment', () => {
  it('charges nothing at or below the first band floor', () => {
    expect(helpRepayment(40_000_00, 50_000_00, FIXTURE_CONFIG)).toBe(0)
    expect(helpRepayment(50_000_00, 50_000_00, FIXTURE_CONFIG)).toBe(0)
  })

  it('charges the marginal rate only on income above the floor', () => {
    // 0.10 × (6,000,000 − 5,000,000)
    expect(helpRepayment(60_000_00, 50_000_00, FIXTURE_CONFIG)).toBe(1_000_00)
  })

  it('accumulates marginal rates across bands', () => {
    // 0.10 × (8,000,000 − 5,000,000) + 0.30 × (9,000,000 − 8,000,000)
    expect(helpRepayment(90_000_00, 50_000_00, FIXTURE_CONFIG)).toBe(6_000_00)
  })

  it('caps the repayment at the maximum rate of whole income', () => {
    // marginal = 0.10 × 3,000,000 + 0.30 × 12,000,000 = 3,900,000;
    // cap = 0.15 × 20,000,000 = 3,000,000, which binds.
    expect(helpRepayment(200_000_00, 50_000_00, FIXTURE_CONFIG)).toBe(30_000_00)
  })

  it('caps the repayment at the outstanding debt', () => {
    expect(helpRepayment(200_000_00, 500_00, FIXTURE_CONFIG)).toBe(500_00)
  })
})

describe('projectHelpPayoff', () => {
  it('returns an empty, zero-year projection for a non-positive balance', () => {
    expect(projectHelpPayoff(0, 60_000_00, FIXTURE_CONFIG, 2027)).toEqual({
      paidOffFinancialYear: null,
      yearsToPayOff: 0,
      schedule: [],
    })
    expect(projectHelpPayoff(-1, 60_000_00, FIXTURE_CONFIG, 2027).schedule).toEqual([])
  })

  it('indexes before crediting the year, exposing both on the first year', () => {
    const { schedule } = projectHelpPayoff(10_000_00, 60_000_00, FIXTURE_CONFIG, 2027)
    // Year 1: index $10,000 by 4% = $400 → $10,400, then repay 10% × ($60,000 − $50,000)
    // = $1,000 against the indexed balance, closing at $9,400.
    expect(schedule[0]).toEqual({
      financialYear: 2027,
      openingBalanceCents: 10_000_00,
      indexationCents: 400_00,
      repaymentCents: 1_000_00,
      closingBalanceCents: 9_400_00,
    })
  })

  it('projects the financial year the debt clears', () => {
    const projection = projectHelpPayoff(3_000_00, 60_000_00, FIXTURE_CONFIG, 2027)
    expect(projection.paidOffFinancialYear).toBe(2030)
    expect(projection.yearsToPayOff).toBe(4)
    expect(projection.schedule).toHaveLength(4)
    expect(projection.schedule.at(-1)?.closingBalanceCents).toBe(0)
  })

  it('reports no payoff when indexation outpaces repayment', () => {
    // Income below the first repayment floor: nil repayment, so the balance only
    // ever grows with indexation and never clears.
    const projection = projectHelpPayoff(10_000_00, 40_000_00, FIXTURE_CONFIG, 2027)
    expect(projection.paidOffFinancialYear).toBeNull()
    expect(projection.yearsToPayOff).toBeNull()
    expect(projection.schedule).toHaveLength(1)
  })

  it('reports no payoff when the debt shrinks but does not clear within the horizon', () => {
    // The balance falls each year (repayment outpaces indexation) but two years is
    // too short to clear it, so the projection stops at the maxYears horizon.
    const projection = projectHelpPayoff(10_000_00, 60_000_00, FIXTURE_CONFIG, 2027, 2)
    expect(projection.paidOffFinancialYear).toBeNull()
    expect(projection.yearsToPayOff).toBeNull()
    expect(projection.schedule).toHaveLength(2)
    expect(projection.schedule.at(-1)?.closingBalanceCents).toBeGreaterThan(0)
  })
})

describe('computeTax', () => {
  it('returns a zero liability and a refund below the tax-free threshold', () => {
    const result = computeTax(
      inputForSalary(15_000_00, { paygWithheldCents: 1_000_00 }),
      FIXTURE_CONFIG,
    )
    expect(result).toEqual({
      taxableIncomeCents: 15_000_00,
      incomeForSurchargeCents: 15_000_00,
      incomeTaxCents: 0,
      litoOffsetCents: 700_00,
      oneOffOffsetCents: 0,
      medicareLevyCents: 0,
      medicareLevySurchargeCents: 0,
      helpRepaymentCents: 0,
      division293Cents: 0,
      totalLiabilityCents: 0,
      paygWithheldCents: 1_000_00,
      balanceCents: -1_000_00,
      repaymentIncomeCents: 15_000_00,
    })
  })

  it('never lets the offset push net income tax below zero', () => {
    // Gross income tax 30,000 < LITO 70,000, so net income tax is floored at 0.
    const result = computeTax(inputForSalary(20_000_00), FIXTURE_CONFIG)
    expect(result.incomeTaxCents).toBe(300_00)
    expect(result.litoOffsetCents).toBe(700_00)
    expect(result.totalLiabilityCents).toBe(0)
  })

  it('computes an amount owing for a high earner with HELP debt', () => {
    const result = computeTax(
      inputForSalary(100_000_00, { helpDebtCents: 20_000_00, paygWithheldCents: 20_000_00 }),
      FIXTURE_CONFIG,
    )
    expect(result).toEqual({
      taxableIncomeCents: 100_000_00,
      incomeForSurchargeCents: 100_000_00,
      incomeTaxCents: 20_550_00,
      litoOffsetCents: 0,
      oneOffOffsetCents: 0,
      medicareLevyCents: 2_000_00,
      medicareLevySurchargeCents: 1_000_00,
      // marginal: 0.10 × (8,000,000 − 5,000,000) + 0.30 × (10,000,000 − 8,000,000)
      helpRepaymentCents: 9_000_00,
      division293Cents: 0,
      totalLiabilityCents: 32_550_00,
      paygWithheldCents: 20_000_00,
      balanceCents: 12_550_00,
      repaymentIncomeCents: 100_000_00,
    })
  })

  it('computes an estimated refund with private cover and taper relief', () => {
    const result = computeTax(
      inputForSalary(40_000_00, { privateHospitalCover: true, paygWithheldCents: 7_000_00 }),
      FIXTURE_CONFIG,
    )
    expect(result).toEqual({
      taxableIncomeCents: 40_000_00,
      incomeForSurchargeCents: 40_000_00,
      incomeTaxCents: 3_300_00,
      litoOffsetCents: 600_00,
      oneOffOffsetCents: 0,
      medicareLevyCents: 800_00,
      medicareLevySurchargeCents: 0,
      helpRepaymentCents: 0,
      division293Cents: 0,
      totalLiabilityCents: 3_500_00,
      paygWithheldCents: 7_000_00,
      balanceCents: -3_500_00,
      repaymentIncomeCents: 40_000_00,
    })
  })
})

describe('division293', () => {
  it('is nil below the threshold', () => {
    expect(division293(100_000_00, 10_000_00, FIXTURE_CONFIG)).toBe(0)
  })

  it('is nil with no concessional contributions', () => {
    expect(division293(200_000_00, 0, FIXTURE_CONFIG)).toBe(0)
  })

  it('taxes only the excess over the threshold when it is the lesser', () => {
    // income + concessional = 155,000; excess 5,000 < 10,000 concessional.
    expect(division293(145_000_00, 10_000_00, FIXTURE_CONFIG)).toBe(750_00)
  })

  it('taxes all concessional contributions when they are the lesser', () => {
    // income + concessional = 210,000; excess 60,000 > 10,000 concessional.
    expect(division293(200_000_00, 10_000_00, FIXTURE_CONFIG)).toBe(1_500_00)
  })
})

describe('superCoContribution', () => {
  // FIXTURE co-contribution: max $500, taper $45,000 → $60,000.
  it('is nil with no eligible contributions', () => {
    expect(superCoContribution(0, 40_000_00, FIXTURE_CONFIG)).toBe(0)
  })

  it('pays the full max below the lower threshold when the match is not the limit', () => {
    // Below $45,000: tapered max is the full $500; 50% × $1,000 = $500 is not the binder.
    expect(superCoContribution(1_000_00, 40_000_00, FIXTURE_CONFIG)).toBe(500_00)
  })

  it('is limited to half the eligible contributions when that is the lesser', () => {
    // Below the lower threshold, but 50% × $600 = $300 < the $500 tapered max.
    expect(superCoContribution(600_00, 40_000_00, FIXTURE_CONFIG)).toBe(300_00)
  })

  it('tapers the max linearly through the income band', () => {
    // Midpoint $52,500: tapered max $250; 50% × $1,000 = $500, so $250 binds.
    expect(superCoContribution(1_000_00, 52_500_00, FIXTURE_CONFIG)).toBe(250_00)
  })

  it('takes half the eligible contributions when that is below the tapered max', () => {
    // Midpoint tapered max $250; 50% × $400 = $200 is the lesser.
    expect(superCoContribution(400_00, 52_500_00, FIXTURE_CONFIG)).toBe(200_00)
  })

  it('is nil at the higher threshold', () => {
    expect(superCoContribution(1_000_00, 60_000_00, FIXTURE_CONFIG)).toBe(0)
  })

  it('is nil above the higher threshold', () => {
    expect(superCoContribution(1_000_00, 70_000_00, FIXTURE_CONFIG)).toBe(0)
  })
})

describe('computeTax with concessional super contributions', () => {
  it('subtracts them from taxable income', () => {
    const result = computeTax(
      inputForSalary(100_000_00, { concessionalContributionsCents: 10_000_00 }),
      FIXTURE_CONFIG,
    )
    expect(result.taxableIncomeCents).toBe(90_000_00)
  })

  it('adds them back for the surcharge and levies Division 293', () => {
    const result = computeTax(
      inputForSalary(200_000_00, { concessionalContributionsCents: 20_000_00 }),
      FIXTURE_CONFIG,
    )
    expect(result.taxableIncomeCents).toBe(180_000_00)
    // Surcharge income adds the contributions back: 1.5% × 200,000, not × 180,000.
    expect(result.medicareLevySurchargeCents).toBe(3_000_00)
    // Division 293: 15% × min(20,000, 200,000 − 150,000).
    expect(result.division293Cents).toBe(3_000_00)
    expect(result.totalLiabilityCents).toBe(60_150_00)
  })

  it('adds them back for HELP repayment income', () => {
    const result = computeTax(
      inputForSalary(80_000_00, {
        concessionalContributionsCents: 20_000_00,
        helpDebtCents: 30_000_00,
      }),
      FIXTURE_CONFIG,
    )
    // Repayment income is 60,000 + 20,000 = 80,000: 10% × (80,000 − 50,000).
    expect(result.helpRepaymentCents).toBe(3_000_00)
  })
})

/**
 * Sanity checks against the verified FY2026 config (real, final ATO figures).
 * These assert known income points reproduce the ATO's published rules — not
 * just the engine's arithmetic. See packages/tax/src/configs.ts for sources.
 */
describe('FY2026_CONFIG', () => {
  it('is registered in configsByYear', () => {
    expect(configsByYear[2026]).toBe(FY2026_CONFIG)
    expect(FY2026_CONFIG.financialYear).toBe(2026)
    expect(FY2026_CONFIG.residency).toBe('resident')
  })

  it('charges no tax below the tax-free threshold', () => {
    const result = computeTax(inputForSalary(15_000_00), FY2026_CONFIG)
    expect(result.taxableIncomeCents).toBe(15_000_00)
    expect(result.incomeTaxCents).toBe(0)
    expect(result.medicareLevyCents).toBe(0)
    expect(result.totalLiabilityCents).toBe(0)
  })

  it('applies the 16% lowest rate for 2025-26', () => {
    // Tax at $45,000 = 16c per $1 over $18,200 = 0.16 × 26,800 = $4,288.
    expect(incomeTax(45_000_00, FY2026_CONFIG)).toBe(4_288_00)
    // Tax at $190,000 = $4,288 + 30% × $90,000 + 37% × $55,000 = $51,638.
    expect(incomeTax(190_000_00, FY2026_CONFIG)).toBe(51_638_00)
  })

  it('computes a mid-bracket earner with HELP debt and private cover', () => {
    const result = computeTax(
      inputForSalary(80_000_00, { privateHospitalCover: true, helpDebtCents: 30_000_00 }),
      FY2026_CONFIG,
    )
    expect(result.incomeTaxCents).toBe(14_788_00)
    expect(result.medicareLevyCents).toBe(1_600_00)
    expect(result.medicareLevySurchargeCents).toBe(0) // private cover exempts
    // Marginal HELP: 15c per $1 over $67,000 = 0.15 × $13,000 = $1,950.
    expect(result.helpRepaymentCents).toBe(1_950_00)
    expect(result.totalLiabilityCents).toBe(18_338_00)
  })

  it('applies the top surcharge tier to a high earner without cover', () => {
    const withoutCover = computeTax(inputForSalary(200_000_00), FY2026_CONFIG)
    expect(withoutCover.medicareLevySurchargeCents).toBe(3_000_00) // 1.5% × $200,000
    const withCover = computeTax(
      inputForSalary(200_000_00, { privateHospitalCover: true }),
      FY2026_CONFIG,
    )
    expect(withCover.medicareLevySurchargeCents).toBe(0)
  })

  it('caps HELP at 10% of repayment income for very high earners', () => {
    // $250,000: marginal exceeds the 10% cap, so repayment = 10% × $250,000.
    expect(helpRepayment(250_000_00, 5_000_000_00, FY2026_CONFIG)).toBe(25_000_00)
  })

  it('carries the final HELP indexation rate applied on 1 June 2026', () => {
    expect(FY2026_CONFIG.helpRepayment.indexationRate).toBe(0.028)
  })

  it('carries the final 2025-26 cents-per-km car expense rate and cap', () => {
    expect(FY2026_CONFIG.carExpense.centsPerKm).toBe(88)
    expect(FY2026_CONFIG.carExpense.maxClaimableKm).toBe(5_000)
  })

  it('gives the maximum LITO below the first taper threshold', () => {
    expect(lowIncomeTaxOffset(30_000_00, FY2026_CONFIG)).toBe(700_00)
    expect(lowIncomeTaxOffset(66_667_00, FY2026_CONFIG)).toBe(0) // cuts out at $66,667
  })

  it('levies Division 293 on a high earner with concessional contributions', () => {
    const result = computeTax(
      inputForSalary(300_000_00, { concessionalContributionsCents: 30_000_00 }),
      FY2026_CONFIG,
    )
    expect(result.taxableIncomeCents).toBe(270_000_00)
    // income + concessional = 300,000; 15% × min(30,000, 300,000 − 250,000).
    expect(result.division293Cents).toBe(4_500_00)
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
    const result = computeTax(inputForSalary(15_000_00), FY2027_CONFIG)
    expect(result.taxableIncomeCents).toBe(15_000_00)
    expect(result.incomeTaxCents).toBe(0)
    expect(result.medicareLevyCents).toBe(0)
    expect(result.totalLiabilityCents).toBe(0)
  })

  it('applies the 15% lowest rate from 1 July 2026', () => {
    // Tax at $45,000 = 15c per $1 over $18,200 = 0.15 × 26,800 = $4,020.
    expect(incomeTax(45_000_00, FY2027_CONFIG)).toBe(4_020_00)
    // Tax at $190,000 = $51,370 (the 2025-26 $51,638 less 1% of $26,800).
    expect(incomeTax(190_000_00, FY2027_CONFIG)).toBe(51_370_00)
  })

  it('computes a mid-bracket earner with HELP debt and private cover', () => {
    const result = computeTax(
      inputForSalary(80_000_00, { privateHospitalCover: true, helpDebtCents: 30_000_00 }),
      FY2027_CONFIG,
    )
    expect(result.incomeTaxCents).toBe(14_520_00)
    expect(result.medicareLevyCents).toBe(1_600_00)
    expect(result.medicareLevySurchargeCents).toBe(0) // private cover exempts
    // Marginal HELP: 15c per $1 over $69,528 = 0.15 × $10,472 = $1,570.80.
    expect(result.helpRepaymentCents).toBe(1_570_80)
    expect(result.totalLiabilityCents).toBe(17_690_80)
  })

  it('applies the top surcharge tier to a high earner without cover', () => {
    const withoutCover = computeTax(inputForSalary(200_000_00), FY2027_CONFIG)
    expect(withoutCover.medicareLevySurchargeCents).toBe(3_000_00) // 1.5% × $200,000
    const withCover = computeTax(
      inputForSalary(200_000_00, { privateHospitalCover: true }),
      FY2027_CONFIG,
    )
    expect(withCover.medicareLevySurchargeCents).toBe(0)
  })

  it('caps HELP at 10% of repayment income for very high earners', () => {
    // $250,000: marginal exceeds the 10% cap, so repayment = 10% × $250,000.
    expect(helpRepayment(250_000_00, 5_000_000_00, FY2027_CONFIG)).toBe(25_000_00)
  })

  it('carries a provisional HELP indexation rate for the payoff projection', () => {
    expect(FY2027_CONFIG.helpRepayment.indexationRate).toBe(0.035)
  })

  it('carries the final 2026-27 cents-per-km car expense rate and cap', () => {
    // 91c = an 89c indexed base plus a temporary 2c one-off uplift for 2026-27,
    // legislated ahead of the year (F2026L00785) — not provisional.
    expect(FY2027_CONFIG.carExpense.centsPerKm).toBe(91)
    expect(FY2027_CONFIG.carExpense.maxClaimableKm).toBe(5_000)
  })

  it('gives the maximum LITO below the first taper threshold', () => {
    expect(lowIncomeTaxOffset(30_000_00, FY2027_CONFIG)).toBe(700_00)
    expect(lowIncomeTaxOffset(66_667_00, FY2027_CONFIG)).toBe(0) // cuts out at $66,667
  })

  it('levies Division 293 on a high earner with concessional contributions', () => {
    const result = computeTax(
      inputForSalary(300_000_00, { concessionalContributionsCents: 30_000_00 }),
      FY2027_CONFIG,
    )
    expect(result.taxableIncomeCents).toBe(270_000_00)
    // income + concessional = 300,000; 15% × min(30,000, 300,000 − 250,000).
    expect(result.division293Cents).toBe(4_500_00)
  })
})

describe('isDateInFinancialYear', () => {
  it('accepts both inclusive bounds of the financial year', () => {
    expect(isDateInFinancialYear('2026-07-01', 2027)).toBe(true)
    expect(isDateInFinancialYear('2027-06-30', 2027)).toBe(true)
    expect(isDateInFinancialYear('2026-12-25', 2027)).toBe(true)
  })

  it('rejects a date either side of the financial year', () => {
    expect(isDateInFinancialYear('2026-06-30', 2027)).toBe(false)
    expect(isDateInFinancialYear('2027-07-01', 2027)).toBe(false)
  })
})

describe('splitOneOffPayment', () => {
  const { genuineRedundancy, capCents, wholeOfIncomeCapCents } =
    FIXTURE_CONFIG.employmentTermination

  it('leaves an ordinary payment wholly assessable with no concession', () => {
    expect(
      splitOneOffPayment({ treatment: 'ordinary', amountCents: 10_000_00 }, 0, FIXTURE_CONFIG),
    ).toEqual({
      taxFreeCents: 0,
      assessableCents: 10_000_00,
      concessionalCents: 0,
      concessionalRate: 0,
    })
  })

  it('excludes a redundancy’s tax-free amount and taxes the rest concessionally', () => {
    // Tax-free = 12,000 base + 5 × 6,000 per year = 42,000 of the 100,000 payment.
    expect(
      splitOneOffPayment(
        { treatment: 'genuineRedundancy', amountCents: 100_000_00, yearsOfService: 5 },
        0,
        FIXTURE_CONFIG,
      ),
    ).toEqual({
      taxFreeCents: 42_000_00,
      assessableCents: 58_000_00,
      concessionalCents: 58_000_00,
      concessionalRate: 0.3,
    })
  })

  it('leaves a redundancy wholly tax-free when the limit exceeds the payment', () => {
    // Tax-free limit 12,000 + 3 × 6,000 = 30,000 against a 20,000 payment.
    expect(
      splitOneOffPayment(
        { treatment: 'genuineRedundancy', amountCents: 20_000_00, yearsOfService: 3 },
        0,
        FIXTURE_CONFIG,
      ),
    ).toEqual({
      taxFreeCents: 20_000_00,
      assessableCents: 0,
      concessionalCents: 0,
      concessionalRate: 0.3,
    })
  })

  it('counts no years of service for a nil, negative, or absent figure', () => {
    const base = { treatment: 'genuineRedundancy', amountCents: 20_000_00 } as const
    const baseLimitOnly = {
      taxFreeCents: genuineRedundancy.baseLimitCents,
      assessableCents: 20_000_00 - genuineRedundancy.baseLimitCents,
      concessionalCents: 20_000_00 - genuineRedundancy.baseLimitCents,
      concessionalRate: 0.3,
    }
    expect(splitOneOffPayment({ ...base, yearsOfService: 0 }, 0, FIXTURE_CONFIG)).toEqual(
      baseLimitOnly,
    )
    expect(splitOneOffPayment({ ...base, yearsOfService: -4 }, 0, FIXTURE_CONFIG)).toEqual(
      baseLimitOnly,
    )
    expect(splitOneOffPayment(base, 0, FIXTURE_CONFIG)).toEqual(baseLimitOnly)
  })

  it('counts only completed years of service', () => {
    // 5.9 years is five completed years: 12,000 + 5 × 6,000 = 42,000.
    expect(
      splitOneOffPayment(
        { treatment: 'genuineRedundancy', amountCents: 100_000_00, yearsOfService: 5.9 },
        0,
        FIXTURE_CONFIG,
      ).taxFreeCents,
    ).toBe(42_000_00)
  })

  it('leaves a redundancy’s excess over the ETP cap to the marginal brackets', () => {
    // Tax-free 12,000; the remaining 288,000 is assessable but only the 200,000 ETP
    // cap of it is concessional — the 88,000 above the cap is taxed on the brackets.
    const split = splitOneOffPayment(
      { treatment: 'genuineRedundancy', amountCents: 300_000_00, yearsOfService: 0 },
      0,
      FIXTURE_CONFIG,
    )
    expect(split).toEqual({
      taxFreeCents: 12_000_00,
      assessableCents: 288_000_00,
      concessionalCents: capCents,
      concessionalRate: 0.3,
    })
    expect(split.assessableCents - split.concessionalCents).toBe(88_000_00)
  })

  it('taxes a non-excluded payment concessionally within the whole-of-income headroom', () => {
    // No other income, so the whole 150,000 whole-of-income cap is headroom and the
    // 100,000 payment fits inside it.
    expect(
      splitOneOffPayment(
        { treatment: 'employmentTermination', amountCents: 100_000_00 },
        0,
        FIXTURE_CONFIG,
      ),
    ).toEqual({
      taxFreeCents: 0,
      assessableCents: 100_000_00,
      concessionalCents: 100_000_00,
      concessionalRate: 0.3,
    })
  })

  it('shrinks a non-excluded payment’s concession to the headroom other income leaves', () => {
    // 120,000 of salary leaves 30,000 of the 150,000 whole-of-income cap.
    expect(
      splitOneOffPayment(
        { treatment: 'employmentTermination', amountCents: 100_000_00 },
        120_000_00,
        FIXTURE_CONFIG,
      ),
    ).toMatchObject({ assessableCents: 100_000_00, concessionalCents: 30_000_00 })
  })

  it('gives a non-excluded payment no concession once salary exhausts the headroom', () => {
    // 160,000 of salary is already past the 150,000 whole-of-income cap, so the whole
    // payment is taxed at marginal rates.
    expect(
      splitOneOffPayment(
        { treatment: 'employmentTermination', amountCents: 100_000_00 },
        wholeOfIncomeCapCents + 10_000_00,
        FIXTURE_CONFIG,
      ),
    ).toEqual({
      taxFreeCents: 0,
      assessableCents: 100_000_00,
      concessionalCents: 0,
      concessionalRate: 0.3,
    })
  })

  it('applies the lower rate at or above preservation age and the higher below it', () => {
    const payment = { treatment: 'employmentTermination', amountCents: 50_000_00 } as const
    expect(
      splitOneOffPayment({ ...payment, atPreservationAge: true }, 0, FIXTURE_CONFIG)
        .concessionalRate,
    ).toBe(0.15)
    expect(
      splitOneOffPayment({ ...payment, atPreservationAge: false }, 0, FIXTURE_CONFIG)
        .concessionalRate,
    ).toBe(0.3)
    // Absent reads as below preservation age — the higher rate.
    expect(splitOneOffPayment(payment, 0, FIXTURE_CONFIG).concessionalRate).toBe(0.3)
  })

  it('caps unused leave at its own maximum rate, uncapped in amount', () => {
    // The whole payment is concessional at the 25% unused-leave maximum, which is
    // neither preservation-age rate, and no cap bounds the amount.
    expect(
      splitOneOffPayment(
        { treatment: 'unusedLeave', amountCents: 300_000_00, atPreservationAge: true },
        0,
        FIXTURE_CONFIG,
      ),
    ).toEqual({
      taxFreeCents: 0,
      assessableCents: 300_000_00,
      concessionalCents: 300_000_00,
      concessionalRate: 0.25,
    })
  })
})

describe('oneOffConcessionOffset', () => {
  it('is nil with no concessions', () => {
    expect(oneOffConcessionOffset(100_000_00, [], FIXTURE_CONFIG)).toBe(0)
  })

  it('is the marginal tax on the amount less what its capped rate charges', () => {
    // Top 50,000 of a 100,000 income: 20,550 − 5,550 = 15,000 marginal, against
    // 15% × 50,000 = 7,500 capped.
    expect(
      oneOffConcessionOffset(
        100_000_00,
        [{ concessionalCents: 50_000_00, rate: 0.15 }],
        FIXTURE_CONFIG,
      ),
    ).toBe(7_500_00)
  })

  it('floors at zero when the capped rate exceeds the marginal rate', () => {
    // Top 10,000 of a 30,000 income attracts 1,500 at the 15% bracket, below the
    // 3,000 the 30% capped rate would charge — so the concession is worth nothing
    // rather than a negative offset against the rest of the income.
    expect(
      oneOffConcessionOffset(
        30_000_00,
        [{ concessionalCents: 10_000_00, rate: 0.3 }],
        FIXTURE_CONFIG,
      ),
    ).toBe(0)
  })

  it('peels stacked concessions off the top in order', () => {
    // Top 100,000 of 200,000: 60,550 − 20,550 = 40,000 marginal less 15,000 capped
    // = 25,000. The next 50,000 sits under it (100,000 → 50,000): 15,000 marginal
    // less 15,000 capped = nil, so the second concession adds nothing.
    expect(
      oneOffConcessionOffset(
        200_000_00,
        [
          { concessionalCents: 100_000_00, rate: 0.15 },
          { concessionalCents: 50_000_00, rate: 0.3 },
        ],
        FIXTURE_CONFIG,
      ),
    ).toBe(25_000_00)
  })

  it('measures a concession larger than the income against the whole income', () => {
    // A 50,000 concession against a 30,000 income leaves nothing under it, so the
    // marginal side is the whole 1,800 of income tax.
    expect(
      oneOffConcessionOffset(
        30_000_00,
        [{ concessionalCents: 50_000_00, rate: 0 }],
        FIXTURE_CONFIG,
      ),
    ).toBe(1_800_00)
  })
})

describe('computeTax with one-off concessions', () => {
  it('reports the offset and nets it against income tax', () => {
    const result = computeTax(
      inputForSalary(50_000_00, {
        assessableIncome: {
          ...NO_INCOME,
          salaryOrWagesCents: 50_000_00,
          employmentTerminationCents: 50_000_00,
        },
        oneOffConcessions: [{ concessionalCents: 50_000_00, rate: 0.15 }],
        privateHospitalCover: true,
      }),
      FIXTURE_CONFIG,
    )
    // Taxable income 100,000; the top 50,000 attracts 15,000 marginal against the
    // 7,500 the 15% capped rate charges, so the offset is 7,500.
    expect(result.taxableIncomeCents).toBe(100_000_00)
    expect(result.incomeTaxCents).toBe(20_550_00)
    expect(result.oneOffOffsetCents).toBe(7_500_00)
    expect(result.totalLiabilityCents).toBe(20_550_00 - 7_500_00 + 2_000_00)
  })

  it('leaves the Medicare levy untouched by the offset', () => {
    const withConcession = computeTax(
      inputForSalary(100_000_00, {
        oneOffConcessions: [{ concessionalCents: 50_000_00, rate: 0.15 }],
      }),
      FIXTURE_CONFIG,
    )
    const without = computeTax(inputForSalary(100_000_00), FIXTURE_CONFIG)
    // The concessional amount stays in taxable income, so the levy is charged on it
    // exactly as on any other income — which is why the config's rates exclude it.
    expect(withConcession.medicareLevyCents).toBe(without.medicareLevyCents)
    expect(withConcession.medicareLevyCents).toBe(2_000_00)
  })

  it('floors net income tax at zero when the offset exceeds the tax payable', () => {
    // Income tax 1,800 against a 1,800 offset and a 700 LITO: the offset is
    // non-refundable, so the excess is lost rather than becoming a refund.
    const result = computeTax(
      inputForSalary(30_000_00, {
        oneOffConcessions: [{ concessionalCents: 30_000_00, rate: 0 }],
        privateHospitalCover: true,
      }),
      FIXTURE_CONFIG,
    )
    expect(result.incomeTaxCents).toBe(1_800_00)
    expect(result.litoOffsetCents).toBe(700_00)
    expect(result.oneOffOffsetCents).toBe(1_800_00)
    // Only the Medicare levy remains, the offsets having no reach into it.
    expect(result.medicareLevyCents).toBe(600_00)
    expect(result.totalLiabilityCents).toBe(600_00)
    expect(result.balanceCents).toBe(600_00)
  })
})

describe('FY2026_CONFIG and FY2027_CONFIG employment-termination figures', () => {
  it('indexes the ETP cap and the redundancy tax-free amounts year on year', () => {
    expect(FY2026_CONFIG.employmentTermination.capCents).toBe(260_000_00)
    expect(FY2027_CONFIG.employmentTermination.capCents).toBe(270_000_00)
    expect(FY2026_CONFIG.employmentTermination.genuineRedundancy).toEqual({
      baseLimitCents: 13_100_00,
      perYearOfServiceCents: 6_552_00,
    })
    expect(FY2027_CONFIG.employmentTermination.genuineRedundancy).toEqual({
      baseLimitCents: 13_598_00,
      perYearOfServiceCents: 6_801_00,
    })
  })

  it('holds the whole-of-income cap and every rate net of the Medicare levy', () => {
    for (const config of [FY2026_CONFIG, FY2027_CONFIG]) {
      const termination = config.employmentTermination
      // The cap is not indexed, so both years carry $180,000.
      expect(termination.wholeOfIncomeCapCents).toBe(180_000_00)
      // The ATO quotes 32% / 17% / 47% and a 32% unused-leave maximum, each of which
      // is the rate here PLUS the 2% Medicare levy the `medicareLevy` line charges.
      expect(termination.belowPreservationAgeRate + config.medicareLevy.rate).toBeCloseTo(0.32, 12)
      expect(termination.atPreservationAgeRate + config.medicareLevy.rate).toBeCloseTo(0.17, 12)
      expect(termination.aboveCapRate + config.medicareLevy.rate).toBeCloseTo(0.47, 12)
      expect(termination.unusedLeaveMaxRate + config.medicareLevy.rate).toBeCloseTo(0.32, 12)
    }
  })

  it('taxes a real redundancy at the concessional rate net of the levy', () => {
    // $200,000 redundancy after 10 years' service under FY2027: tax-free
    // 13,598 + 10 × 6,801 = 81,608, leaving 118,392 assessable and concessional.
    const split = splitOneOffPayment(
      { treatment: 'genuineRedundancy', amountCents: 200_000_00, yearsOfService: 10 },
      0,
      FY2027_CONFIG,
    )
    expect(split.taxFreeCents).toBe(81_608_00)
    expect(split.assessableCents).toBe(118_392_00)
    expect(split.concessionalCents).toBe(118_392_00)

    // Paid on top of a $200,000 salary, so the slice would otherwise be taxed at the
    // top 45% marginal rate and the 30% cap really binds.
    const salaryOnly = inputForSalary(200_000_00, { privateHospitalCover: true })
    const withRedundancy = computeTax(
      {
        ...salaryOnly,
        assessableIncome: {
          ...salaryOnly.assessableIncome,
          employmentTerminationCents: split.assessableCents,
        },
        oneOffConcessions: [
          { concessionalCents: split.concessionalCents, rate: split.concessionalRate },
        ],
      },
      FY2027_CONFIG,
    )
    const withoutRedundancy = computeTax(salaryOnly, FY2027_CONFIG)
    // The offset is the marginal tax the slice attracts less what 30% charges on it.
    expect(withRedundancy.oneOffOffsetCents).toBe(
      withRedundancy.incomeTaxCents -
        withoutRedundancy.incomeTaxCents -
        Math.round(split.concessionalCents * 0.3),
    )
    // What the redundancy costs in total is 30% income tax plus the 2% levy on it —
    // the ATO's quoted 32%, which is exactly why the config rate excludes the levy.
    expect(withRedundancy.totalLiabilityCents - withoutRedundancy.totalLiabilityCents).toBe(
      Math.round(split.concessionalCents * 0.32),
    )
  })

  it('leaves a redundancy at marginal rates where they sit below the capped rate', () => {
    // The same payment as the member's only income: the concessional rate is a
    // MAXIMUM, so a marginal rate below it stands and the offset is nil.
    const split = splitOneOffPayment(
      { treatment: 'genuineRedundancy', amountCents: 200_000_00, yearsOfService: 10 },
      0,
      FY2027_CONFIG,
    )
    const result = computeTax(
      {
        assessableIncome: { ...NO_INCOME, employmentTerminationCents: split.assessableCents },
        deductionsCents: 0,
        residency: 'resident',
        privateHospitalCover: true,
        helpDebtCents: 0,
        paygWithheldCents: 0,
        oneOffConcessions: [
          { concessionalCents: split.concessionalCents, rate: split.concessionalRate },
        ],
      },
      FY2027_CONFIG,
    )
    expect(result.oneOffOffsetCents).toBe(0)
    expect(result.incomeTaxCents).toBeLessThan(Math.round(split.concessionalCents * 0.3))
  })
})

describe('salarySacrificeWhatIf', () => {
  it('saves marginal tax for a mid-bracket earner sacrificing more', () => {
    // $100,000 salary, no existing concessional, private cover (no surcharge),
    // no HELP debt. An extra $10,000 sacrifice sits wholly in the 30% bracket, so
    // it saves 30% income tax + 2% Medicare = $3,200; neither run attracts LITO,
    // the surcharge, HELP, or Division 293.
    const result = salarySacrificeWhatIf(
      inputForSalary(100_000_00, { privateHospitalCover: true }),
      10_000_00,
      FIXTURE_CONFIG,
    )
    expect(result.taxSavedCents).toBe(3_200_00)
    expect(result.division293DeltaCents).toBe(0)
  })

  it('lands 85% of the extra sacrifice in super after the 15% contributions tax', () => {
    const result = salarySacrificeWhatIf(inputForSalary(100_000_00), 10_000_00, FIXTURE_CONFIG)
    expect(result.contributionsTaxCents).toBe(1_500_00)
    expect(result.netToSuperCents).toBe(8_500_00)
    expect(result.netToSuperCents).toBe(Math.round(10_000_00 * 0.85))
  })

  it('reduces take-home by the amount sacrificed less the tax saved', () => {
    // $3,200 saved against $10,000 sacrificed → take-home falls $6,800.
    const result = salarySacrificeWhatIf(
      inputForSalary(100_000_00, { privateHospitalCover: true }),
      10_000_00,
      FIXTURE_CONFIG,
    )
    expect(result.takeHomeChangeCents).toBe(result.taxSavedCents - 10_000_00)
    expect(result.takeHomeChangeCents).toBe(-6_800_00)
  })

  it('reports the extra Division 293 a high earner triggers', () => {
    // $200,000 salary, no existing concessional (so baseline Division 293 is nil).
    // An extra $20,000 sacrifice drops taxable to $180,000; Division 293 income is
    // $200,000, so 15% × min($20,000, $200,000 − $150,000) = $3,000.
    const result = salarySacrificeWhatIf(inputForSalary(200_000_00), 20_000_00, FIXTURE_CONFIG)
    expect(result.division293DeltaCents).toBe(3_000_00)
    // The Division 293 rise nets against the marginal tax saved.
    expect(result.taxSavedCents).toBeGreaterThan(0)
  })

  it('yields all-zero deltas for no additional sacrifice', () => {
    const result = salarySacrificeWhatIf(inputForSalary(100_000_00), 0, FIXTURE_CONFIG)
    expect(result).toEqual({
      additionalConcessionalCents: 0,
      taxSavedCents: 0,
      contributionsTaxCents: 0,
      netToSuperCents: 0,
      takeHomeChangeCents: 0,
      division293DeltaCents: 0,
    })
  })
})

describe('carExpenseDeductionCents', () => {
  it('multiplies distance by the rate and rounds to whole cents', () => {
    // 100km × 90c = $90.00.
    expect(carExpenseDeductionCents(100, FIXTURE_CONFIG)).toBe(90_00)
  })

  it('rounds a fractional-km distance to the nearest cent', () => {
    // 12.5km × 90c = $11.25.
    expect(carExpenseDeductionCents(12.5, FIXTURE_CONFIG)).toBe(11_25)
  })

  it('is nil for zero distance', () => {
    expect(carExpenseDeductionCents(0, FIXTURE_CONFIG)).toBe(0)
  })

  it('floors a negative distance at zero', () => {
    expect(carExpenseDeductionCents(-10, FIXTURE_CONFIG)).toBe(0)
  })

  it("uses each financial year's own published rate", () => {
    expect(carExpenseDeductionCents(5_000, FY2026_CONFIG)).toBe(4_400_00) // 5,000km × 88c
    expect(carExpenseDeductionCents(5_000, FY2027_CONFIG)).toBe(4_550_00) // 5,000km × 91c
  })
})
