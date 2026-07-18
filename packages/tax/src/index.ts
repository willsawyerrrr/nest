/**
 * Shared, framework-agnostic tax domain. Imported by the PWA (for instant
 * client-side preview) and by the Supabase edge function (authoritative), so the
 * computation lives in exactly one place. Pure — no I/O, no side effects.
 */

export { FY2027_CONFIG, configsByYear } from './configs'

export { annualGrossCents, estimateHouseholdTax } from './estimate'
export type {
  HouseholdTaxEstimate,
  IncomeInput,
  IncomeSchedule,
  MemberTaxEstimate,
  TaxProfileInput,
} from './estimate'

/** A monetary amount in integer minor units (cents). Never a float. */
export type Money = number

/**
 * An Australian financial year, labelled by the calendar year in which it ends.
 * FY2027 runs 1 July 2026 – 30 June 2027.
 */
export type FinancialYear = number

/** Residency status. Resident and foreign-resident brackets and levies differ. */
export type Residency = 'resident' | 'foreignResident'

/** One marginal tax bracket. `upToCents` is `null` for the top bracket. */
export interface TaxBracket {
  readonly upToCents: Money | null
  readonly rate: number
}

/**
 * Low Income Tax Offset parameters. The offset starts at `maxOffsetCents` and is
 * reduced across ordered taper bands. Each band applies `reductionPerDollar` to
 * every dollar of taxable income above its `incomeOverCents`, up to the next
 * band's threshold (or without limit for the final band).
 */
export interface LitoConfig {
  readonly maxOffsetCents: Money
  readonly taperRules: readonly LitoTaperRule[]
}

/** One ordered LITO taper band. */
export interface LitoTaperRule {
  readonly incomeOverCents: Money
  readonly reductionPerDollar: number
}

/**
 * Medicare levy parameters. Below `lowIncomeThresholdCents` no levy is payable;
 * above it the levy phases in at `phaseInRate` per dollar until it reaches the
 * full `rate` of taxable income.
 */
export interface MedicareLevyConfig {
  readonly rate: number
  readonly lowIncomeThresholdCents: Money
  readonly phaseInRate: number
}

/**
 * Medicare levy surcharge tiers, ordered ascending by threshold. The surcharge
 * applies the rate of the highest tier whose single `incomeOverCents` the income
 * exceeds, to the whole income (it is not marginal).
 */
export interface MedicareLevySurchargeConfig {
  readonly tiers: readonly MedicareLevySurchargeTier[]
  /** Family threshold increase per MLS dependent child after the first. */
  readonly familyDependentChildIncrementCents: Money
}

/** One Medicare levy surcharge tier. */
export interface MedicareLevySurchargeTier {
  /** Single income floor above which this tier's `rate` applies. */
  readonly incomeOverCents: Money
  /** Family income floor for the same tier; carried for household modelling. */
  readonly familyIncomeOverCents: Money
  readonly rate: number
}

/**
 * HELP/HECS compulsory repayment schedule. From 1 July 2025 the repayment is
 * marginal: `rate` applies to repayment income within each band above that
 * band's floor, and the total is then capped at `maxRepaymentRate` of the whole
 * repayment income (the cap binds only at high incomes). Bands are ordered
 * ascending by floor; no repayment is due at or below the first band's floor.
 */
export interface HelpRepaymentConfig {
  readonly marginalBands: readonly HelpRepaymentBand[]
  readonly maxRepaymentRate: number
}

/** One marginal HELP/HECS band: `rate` on repayment income above `incomeOverCents`. */
export interface HelpRepaymentBand {
  readonly incomeOverCents: Money
  readonly rate: number
}

/**
 * Versioned AU tax parameters for a single financial year and residency. Real
 * ATO figures are loaded from config per year; nothing here is hardcoded in
 * computation logic.
 */
export interface TaxYearConfig {
  readonly financialYear: FinancialYear
  readonly residency: Residency
  readonly brackets: readonly TaxBracket[]
  readonly medicareLevy: MedicareLevyConfig
  readonly medicareLevySurcharge: MedicareLevySurchargeConfig
  readonly lito: LitoConfig
  readonly helpRepayment: HelpRepaymentConfig
  /** Employer super contribution rate; carried for projections, not liability. */
  readonly superGuaranteeRate: number
}

/** Assessable income components for a member for one financial year. */
export interface AssessableIncome {
  readonly salaryOrWagesCents: Money
  readonly businessCents: Money
  readonly investmentCents: Money
  readonly otherCents: Money
}

/** A member's figures for one financial year, paired with a `TaxYearConfig`. */
export interface TaxInput {
  readonly assessableIncome: AssessableIncome
  readonly deductionsCents: Money
  readonly residency: Residency
  /** Whether private hospital cover is held; exempts the surcharge when true. */
  readonly privateHospitalCover: boolean
  readonly helpDebtCents: Money
  readonly paygWithheldCents: Money
}

/**
 * A full liability breakdown, every field an integer cent amount. `incomeTaxCents`
 * is gross tax on the brackets and `litoOffsetCents` the offset applied against
 * it; `totalLiabilityCents` nets the offset (floored at zero) before adding the
 * levies and repayment. `balanceCents` is positive when owing, negative for an
 * estimated refund.
 */
export interface TaxBreakdown {
  readonly taxableIncomeCents: Money
  readonly incomeTaxCents: Money
  readonly litoOffsetCents: Money
  readonly medicareLevyCents: Money
  readonly medicareLevySurchargeCents: Money
  readonly helpRepaymentCents: Money
  readonly totalLiabilityCents: Money
  readonly paygWithheldCents: Money
  readonly balanceCents: Money
}

/** Returns the AU financial year (ending-year label) that `date` falls in. */
export function financialYearForDate(date: Date): FinancialYear {
  const year = date.getUTCFullYear()
  const isSecondHalf = date.getUTCMonth() >= 6 // July is month index 6
  return isSecondHalf ? year + 1 : year
}

/**
 * Rounds a fractional-cent amount to the nearest whole cent, halves rounded up.
 * Every component of the breakdown is rounded independently so that all reported
 * fields are integers; the total is the arithmetic of those integer fields.
 */
function roundCents(value: number): Money {
  return Math.round(value)
}

/** Taxable income = total assessable income − deductions, floored at zero. */
export function taxableIncome(input: TaxInput): Money {
  const { salaryOrWagesCents, businessCents, investmentCents, otherCents } = input.assessableIncome
  const assessable = salaryOrWagesCents + businessCents + investmentCents + otherCents
  return Math.max(0, assessable - input.deductionsCents)
}

/** Applies the ordered marginal brackets to `taxableIncomeCents`. */
export function incomeTax(taxableIncomeCents: Money, config: TaxYearConfig): Money {
  let tax = 0
  let lowerCents = 0
  for (const bracket of config.brackets) {
    if (taxableIncomeCents <= lowerCents) break
    const upper = bracket.upToCents ?? taxableIncomeCents
    const bandTop = Math.min(taxableIncomeCents, upper)
    tax += (bandTop - lowerCents) * bracket.rate
    lowerCents = upper
  }
  return roundCents(tax)
}

/** Computes the Low Income Tax Offset after its taper bands. */
export function lowIncomeTaxOffset(taxableIncomeCents: Money, config: TaxYearConfig): Money {
  const { maxOffsetCents, taperRules } = config.lito
  let reduction = 0
  for (let i = 0; i < taperRules.length; i++) {
    const rule = taperRules[i]!
    if (taxableIncomeCents <= rule.incomeOverCents) break
    const next = taperRules[i + 1]
    const segmentTop = next
      ? Math.min(taxableIncomeCents, next.incomeOverCents)
      : taxableIncomeCents
    reduction += (segmentTop - rule.incomeOverCents) * rule.reductionPerDollar
  }
  return roundCents(Math.max(0, maxOffsetCents - reduction))
}

/** Computes the Medicare levy with its low-income phase-in. */
export function medicareLevy(taxableIncomeCents: Money, config: TaxYearConfig): Money {
  const { rate, lowIncomeThresholdCents, phaseInRate } = config.medicareLevy
  if (taxableIncomeCents <= lowIncomeThresholdCents) return 0
  const full = taxableIncomeCents * rate
  const phasedIn = (taxableIncomeCents - lowIncomeThresholdCents) * phaseInRate
  return roundCents(Math.min(full, phasedIn))
}

/**
 * Computes the Medicare levy surcharge. Exempt when private hospital cover is
 * held. Simplification: income for surcharge purposes is taken as taxable income
 * (per docs/TAX.md it technically also includes reportable fringe benefits and
 * super, modelled as a follow-up).
 */
export function medicareLevySurcharge(
  incomeForSurchargeCents: Money,
  hasPrivateHospitalCover: boolean,
  config: TaxYearConfig,
): Money {
  if (hasPrivateHospitalCover) return 0
  let rate = 0
  for (const tier of config.medicareLevySurcharge.tiers) {
    if (incomeForSurchargeCents <= tier.incomeOverCents) break
    rate = tier.rate
  }
  return roundCents(incomeForSurchargeCents * rate)
}

/**
 * Computes the compulsory HELP/HECS repayment, capped at the outstanding debt.
 * Marginal across `marginalBands`, then limited to `maxRepaymentRate` of the
 * whole repayment income; nil at or below the first band's floor.
 * Simplification: repayment income is taken as taxable income (per docs/TAX.md it
 * technically also includes reportable super and net investment losses, modelled
 * as a follow-up).
 */
export function helpRepayment(
  repaymentIncomeCents: Money,
  helpDebtCents: Money,
  config: TaxYearConfig,
): Money {
  const { marginalBands, maxRepaymentRate } = config.helpRepayment
  let marginal = 0
  for (let i = 0; i < marginalBands.length; i++) {
    const band = marginalBands[i]!
    if (repaymentIncomeCents <= band.incomeOverCents) break
    const next = marginalBands[i + 1]
    const bandTop = next
      ? Math.min(repaymentIncomeCents, next.incomeOverCents)
      : repaymentIncomeCents
    marginal += (bandTop - band.incomeOverCents) * band.rate
  }
  const capped = Math.min(marginal, repaymentIncomeCents * maxRepaymentRate)
  return Math.min(roundCents(capped), Math.max(0, helpDebtCents))
}

/**
 * Computes the full income-tax breakdown for a member's financial year. The
 * caller selects the `config` matching the member's residency and financial year.
 * Offsets reduce tax payable but not below zero, and never reduce the levies.
 */
export function computeTax(input: TaxInput, config: TaxYearConfig): TaxBreakdown {
  const taxableIncomeCents = taxableIncome(input)
  const incomeTaxCents = incomeTax(taxableIncomeCents, config)
  const litoOffsetCents = lowIncomeTaxOffset(taxableIncomeCents, config)
  const netIncomeTaxCents = Math.max(0, incomeTaxCents - litoOffsetCents)
  const medicareLevyCents = medicareLevy(taxableIncomeCents, config)
  const medicareLevySurchargeCents = medicareLevySurcharge(
    taxableIncomeCents,
    input.privateHospitalCover,
    config,
  )
  const helpRepaymentCents = helpRepayment(taxableIncomeCents, input.helpDebtCents, config)
  const totalLiabilityCents =
    netIncomeTaxCents + medicareLevyCents + medicareLevySurchargeCents + helpRepaymentCents
  const balanceCents = totalLiabilityCents - input.paygWithheldCents
  return {
    taxableIncomeCents,
    incomeTaxCents,
    litoOffsetCents,
    medicareLevyCents,
    medicareLevySurchargeCents,
    helpRepaymentCents,
    totalLiabilityCents,
    paygWithheldCents: input.paygWithheldCents,
    balanceCents,
  }
}
