/**
 * Verified per-financial-year AU tax configs, sourced from ato.gov.au. Every
 * figure carries its authoritative source URL. Amounts are integer cents.
 *
 * Figures flagged PROVISIONAL are the latest published (2025-26) values reused
 * because the ATO has not yet published a 2026-27 figure; they are indexed
 * annually and will change. All other figures are the ATO's published or
 * legislated 2026-27 values.
 */

import type { FinancialYear, TaxYearConfig } from './index'

/**
 * Resident config for FY2027 (1 Jul 2026 – 30 Jun 2027).
 *
 * The 2025 Budget "top-up" cut (Treasury Laws Amendment (More Cost of Living
 * Relief) Act 2025, now law) reduces the lowest marginal rate from 16% to 15%
 * from 1 July 2026; thresholds and the other rates are unchanged.
 */
export const FY2027_CONFIG: TaxYearConfig = {
  financialYear: 2027,
  residency: 'resident',

  // Resident marginal brackets for 2026-27. Lowest rate 15% (down from 16%):
  //   https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-australian-taxpayer
  // Thresholds and the 30/37/45% rates carry the 2025-26 schedule unchanged:
  //   https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents
  brackets: [
    { upToCents: 18_200_00, rate: 0.0 }, // $0 – $18,200
    { upToCents: 45_000_00, rate: 0.15 }, // $18,201 – $45,000
    { upToCents: 135_000_00, rate: 0.3 }, // $45,001 – $135,000
    { upToCents: 190_000_00, rate: 0.37 }, // $135,001 – $190,000
    { upToCents: null, rate: 0.45 }, // $190,001 +
  ],

  // Medicare levy: 2% rate, confirmed on the resident rates page above.
  // Low-income single lower threshold $28,011 (upper $35,013); the levy phases
  // in at 10c per $1 over the lower threshold until it reaches the 2% rate.
  //   https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners
  // PROVISIONAL: $28,011 is the 2025-26 figure; 2026-27 not yet published.
  // Not modelled here (single-earner reduction only): SAPTO single lower
  // $44,268 / upper $55,335; family lower $47,238 / upper $59,047 (+$4,338
  // lower, +$5,423 upper per dependent child); SAPTO family lower $61,623 /
  // upper $77,028 — same sources, likewise 2025-26 PROVISIONAL.
  medicareLevy: {
    rate: 0.02,
    lowIncomeThresholdCents: 28_011_00, // $28,011 (2025-26, PROVISIONAL)
    phaseInRate: 0.1,
  },

  // Medicare levy surcharge tiers for 2026-27 (published). Single floors and the
  // family floors carried alongside them; +$1,500 per dependent child after the
  // first. Compute uses single floors; family data is carried for future
  // household modelling.
  //   https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates
  medicareLevySurcharge: {
    tiers: [
      { incomeOverCents: 105_000_00, familyIncomeOverCents: 210_000_00, rate: 0.01 },
      { incomeOverCents: 123_000_00, familyIncomeOverCents: 246_000_00, rate: 0.0125 },
      { incomeOverCents: 164_000_00, familyIncomeOverCents: 328_000_00, rate: 0.015 },
    ],
    familyDependentChildIncrementCents: 1_500_00, // +$1,500 per child after first
  },

  // Low Income Tax Offset: max $700; 5c/$1 over $37,500, then 1.5c/$1 over
  // $45,000; cuts out at $66,667. Legislated, not indexed.
  //   https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset
  lito: {
    maxOffsetCents: 700_00, // $700
    taperRules: [
      { incomeOverCents: 37_500_00, reductionPerDollar: 0.05 }, // over $37,500
      { incomeOverCents: 45_000_00, reductionPerDollar: 0.015 }, // over $45,000
    ],
  },

  // HELP/HECS marginal repayment schedule for 2026-27 (published):
  //   $0 – $69,528: nil
  //   $69,529 – $129,717: 15c per $1 over $69,528
  //   $129,718 – $186,050: $9,028 + 17c per $1 over $129,717
  //   $186,051 +: 10% of total repayment income
  // Modelled as marginal bands (0.15 over $69,528; 0.17 over $129,717) capped at
  // 10% of repayment income; the cap reproduces the whole-of-income top band.
  //   https://www.ato.gov.au/tax-rates-and-codes/study-and-training-support-loans-rates-and-repayment-thresholds
  helpRepayment: {
    marginalBands: [
      { incomeOverCents: 69_528_00, rate: 0.15 }, // over $69,528
      { incomeOverCents: 129_717_00, rate: 0.17 }, // over $129,717
    ],
    maxRepaymentRate: 0.1,
  },

  // Super guarantee 12.00% (from 1 July 2025). Carried for projections only.
  //   https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds/super-guarantee
  superGuaranteeRate: 0.12,
}

/** Verified configs keyed by financial year (resident). */
export const configsByYear: Readonly<Record<FinancialYear, TaxYearConfig>> = {
  2027: FY2027_CONFIG,
}
