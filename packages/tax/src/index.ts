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
  /** Family income floor for the same tier, used by the family MLS assessment. */
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
  readonly super: SuperConfig
}

/**
 * Versioned AU superannuation parameters. Concessional contributions reduce
 * taxable income and, above `division293ThresholdCents`, attract Division 293
 * tax; the caps, contributions-tax rate, co-contribution, and preservation age
 * are consumed by the caps, co-contribution, and retirement-projection layers.
 */
export interface SuperConfig {
  /** Employer super guarantee rate, on ordinary time earnings. */
  readonly guaranteeRate: number
  /** Annual concessional (pre-tax) contributions cap. */
  readonly concessionalCapCents: Money
  /** Tax levied on concessional contributions inside the fund. */
  readonly contributionsTaxRate: number
  /** Annual non-concessional (after-tax) contributions cap. */
  readonly nonConcessionalCapCents: Money
  /** Income (taxable income + concessional contributions) above which Division 293 applies. */
  readonly division293ThresholdCents: Money
  /** Extra tax rate Division 293 levies on concessional contributions above the threshold. */
  readonly division293Rate: number
  /** Total super balance below which unused concessional cap can be carried forward. */
  readonly carryForwardBalanceCapCents: Money
  /** General transfer balance cap. */
  readonly generalTransferBalanceCapCents: Money
  /** Government co-contribution parameters. */
  readonly coContribution: SuperCoContributionConfig
  /** Preservation age at which super can be accessed. */
  readonly preservationAge: number
}

/** Government super co-contribution: full below the lower threshold, tapering to nil at the higher. */
export interface SuperCoContributionConfig {
  readonly maxCents: Money
  readonly lowerIncomeThresholdCents: Money
  readonly higherIncomeThresholdCents: Money
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
  /**
   * Annual concessional (pre-tax) super contributions — salary sacrifice plus
   * personal deductible. Reduces taxable income and drives Division 293; absent
   * is treated as nil.
   */
  readonly concessionalContributionsCents?: Money
  /**
   * A pre-computed Medicare levy surcharge to use for this member instead of the
   * per-person assessment. The household layer sets it so the surcharge line and
   * total reflect the family-income assessment (see `familyMedicareLevySurcharge`);
   * absent, `computeTax` assesses the surcharge per person from this input.
   */
  readonly medicareLevySurchargeCentsOverride?: Money
}

/**
 * A full liability breakdown, every field an integer cent amount. `incomeTaxCents`
 * is gross tax on the brackets and `litoOffsetCents` the offset applied against
 * it; `totalLiabilityCents` nets the offset (floored at zero) before adding the
 * levies, repayment, and Division 293. `balanceCents` is positive when owing,
 * negative for an estimated refund. `division293Cents` is the extra tax on
 * concessional contributions for high earners (nil for most).
 */
export interface TaxBreakdown {
  readonly taxableIncomeCents: Money
  /**
   * Income for Medicare levy surcharge purposes — taxable income plus reportable
   * (concessional) super contributions. The per-person surcharge is assessed on
   * it, and it is the base a household-level MLS what-if sums across members.
   */
  readonly incomeForSurchargeCents: Money
  readonly incomeTaxCents: Money
  readonly litoOffsetCents: Money
  readonly medicareLevyCents: Money
  readonly medicareLevySurchargeCents: Money
  readonly helpRepaymentCents: Money
  readonly division293Cents: Money
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
 * The inclusive UTC bounds of a financial year: `start` is 1 July of the year
 * before the label, `end` is 30 June of the label year (e.g. FY2027 →
 * 1 Jul 2026 – 30 Jun 2027). UTC to match `financialYearForDate`.
 */
export function financialYearBounds(financialYear: FinancialYear): {
  readonly start: Date
  readonly end: Date
} {
  return {
    start: new Date(Date.UTC(financialYear - 1, 6, 1)),
    end: new Date(Date.UTC(financialYear, 5, 30)),
  }
}

/** Milliseconds in a day, for inclusive calendar-day arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** The inclusive count of calendar days from `start` to `end` (both UTC midnights). */
function inclusiveDayCount(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1
}

/** Parses an ISO date (`YYYY-MM-DD`) as a UTC midnight, matching the FY bounds. */
function isoDateToUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

/**
 * The fraction of financial year `financialYear` for which an inflow is active,
 * counted in inclusive calendar days. The inflow's window is
 * `[startsOn ?? fyStart, endsOn ?? fyEnd]`; its overlap with the financial year,
 * measured inclusively, is divided by the FY's inclusive day count (365 or 366).
 *
 * Returns 1 when both dates are absent (applies all year), 0 when the window does
 * not intersect the financial year, and is otherwise clamped to `[0, 1]`. Because
 * the day count is inclusive, adjacent windows (an old inflow's `endsOn` being the
 * day before a new inflow's `startsOn`) sum to exactly the whole financial year.
 */
export function activeFractionOfFinancialYear(
  startsOn: string | undefined,
  endsOn: string | undefined,
  financialYear: FinancialYear,
): number {
  const { start: fyStart, end: fyEnd } = financialYearBounds(financialYear)
  const windowStart = startsOn ? isoDateToUtc(startsOn) : fyStart
  const windowEnd = endsOn ? isoDateToUtc(endsOn) : fyEnd
  const overlapStart = windowStart > fyStart ? windowStart : fyStart
  const overlapEnd = windowEnd < fyEnd ? windowEnd : fyEnd
  if (overlapEnd < overlapStart) {
    return 0
  }
  const fraction = inclusiveDayCount(overlapStart, overlapEnd) / inclusiveDayCount(fyStart, fyEnd)
  return Math.min(1, Math.max(0, fraction))
}

/**
 * Rounds a fractional-cent amount to the nearest whole cent, halves rounded up.
 * Every component of the breakdown is rounded independently so that all reported
 * fields are integers; the total is the arithmetic of those integer fields.
 */
function roundCents(value: number): Money {
  return Math.round(value)
}

/**
 * Taxable income = total assessable income − deductions − concessional super
 * contributions, floored at zero. Salary sacrifice and personal deductible
 * contributions both reduce assessable income, so they are subtracted here.
 */
export function taxableIncome(input: TaxInput): Money {
  const { salaryOrWagesCents, businessCents, investmentCents, otherCents } = input.assessableIncome
  const assessable = salaryOrWagesCents + businessCents + investmentCents + otherCents
  const concessional = input.concessionalContributionsCents ?? 0
  return Math.max(0, assessable - input.deductionsCents - concessional)
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
 * held. The caller passes income for surcharge purposes — taxable income plus
 * reportable (concessional) super contributions; reportable fringe benefits and
 * net investment losses are still not modelled (see docs/tax.md).
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

/** One member's inputs to the family Medicare levy surcharge assessment. */
export interface FamilyMlsMember {
  readonly incomeForSurchargeCents: Money
  readonly hasPrivateHospitalCover: boolean
}

/**
 * The outcome of a family Medicare levy surcharge assessment. `tierRate` is the
 * single rate the combined family income selects; `thresholdCents` is the family
 * floor it was compared against (the selected tier's, or the lowest tier's when no
 * surcharge applies). `perMemberSurchargeCents` is aligned to the input order, nil
 * for a member who holds cover; `totalSurchargeCents` sums it.
 */
export interface FamilyMlsResult {
  readonly combinedIncomeForSurchargeCents: Money
  readonly tierRate: number
  readonly thresholdCents: Money
  readonly perMemberSurchargeCents: readonly Money[]
  readonly totalSurchargeCents: Money
}

/**
 * Assesses the Medicare levy surcharge across a household. The tier RATE is chosen
 * by the members' COMBINED surcharge income against the FAMILY thresholds, each
 * tier's effective family floor being `familyIncomeOverCents` plus
 * `familyDependentChildIncrementCents` for every dependent child after the first.
 * A member is liable only when they lack cover; when liable, their surcharge is
 * their OWN income at the family-selected rate (a per-person base, family-selected
 * rate), rounded to whole cents. A single-member household with no dependent
 * children falls back to the single-person floors, so the helper is correct for
 * both shapes. Nil rate and nil total when combined income is at or below the
 * lowest applicable floor.
 */
export function familyMedicareLevySurcharge(
  members: readonly FamilyMlsMember[],
  dependentChildren: number,
  config: TaxYearConfig,
): FamilyMlsResult {
  const { tiers, familyDependentChildIncrementCents } = config.medicareLevySurcharge
  const useSingleFloors = members.length === 1 && dependentChildren === 0
  const increment = Math.max(0, dependentChildren - 1) * familyDependentChildIncrementCents
  const floorOf = (tier: MedicareLevySurchargeTier): Money =>
    useSingleFloors ? tier.incomeOverCents : tier.familyIncomeOverCents + increment

  const combinedIncomeForSurchargeCents = members.reduce(
    (total, member) => total + member.incomeForSurchargeCents,
    0,
  )

  let tierRate = 0
  let thresholdCents = tiers.length > 0 ? floorOf(tiers[0]!) : 0
  for (const tier of tiers) {
    if (combinedIncomeForSurchargeCents <= floorOf(tier)) break
    tierRate = tier.rate
    thresholdCents = floorOf(tier)
  }

  const perMemberSurchargeCents = members.map((member) =>
    member.hasPrivateHospitalCover ? 0 : roundCents(member.incomeForSurchargeCents * tierRate),
  )
  const totalSurchargeCents = perMemberSurchargeCents.reduce((total, cents) => total + cents, 0)

  return {
    combinedIncomeForSurchargeCents,
    tierRate,
    thresholdCents,
    perMemberSurchargeCents,
    totalSurchargeCents,
  }
}

/**
 * Computes the compulsory HELP/HECS repayment, capped at the outstanding debt.
 * Marginal across `marginalBands`, then limited to `maxRepaymentRate` of the
 * whole repayment income; nil at or below the first band's floor. The caller
 * passes repayment income — taxable income plus reportable (concessional) super
 * contributions; net investment losses are still not modelled (see docs/tax.md).
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
 * Computes Division 293 tax: an extra `division293Rate` on the lesser of the
 * concessional contributions and the amount by which Division 293 income
 * (taxable income + concessional contributions) exceeds the threshold. Nil below
 * the threshold or with no concessional contributions. Simplification: Division
 * 293 income is approximated as taxable income + concessional contributions,
 * omitting reportable fringe benefits and net investment losses (see docs/tax.md).
 */
export function division293(
  taxableIncomeCents: Money,
  concessionalContributionsCents: Money,
  config: TaxYearConfig,
): Money {
  const { division293ThresholdCents, division293Rate } = config.super
  if (concessionalContributionsCents <= 0) return 0
  const excessCents =
    taxableIncomeCents + concessionalContributionsCents - division293ThresholdCents
  if (excessCents <= 0) return 0
  return roundCents(Math.min(concessionalContributionsCents, excessCents) * division293Rate)
}

/**
 * Estimates the government super co-contribution — the co-payment the government
 * adds to super, matching 50c per $1 of eligible personal non-concessional
 * contributions up to `maxCents`, tapered out across the income test.
 *
 * `taperedMax` reduces the maximum linearly from `maxCents` at the lower income
 * threshold to nil at the higher; the entitlement is the lesser of that and half
 * the eligible contributions, rounded to whole cents. Nil with no eligible
 * contributions or at/above the higher threshold.
 *
 * `personalNonConcessionalCents` is the eligible base — personal non-concessional
 * contributions only. Simplification: the remaining eligibility conditions (age
 * under 71, the 10%-employment-income test, and a total super balance under the
 * general transfer balance cap) are assumed met, and `totalIncomeCents` is
 * approximated as the member's annual assessable income.
 */
export function superCoContribution(
  personalNonConcessionalCents: Money,
  totalIncomeCents: Money,
  config: TaxYearConfig,
): Money {
  const { maxCents, lowerIncomeThresholdCents, higherIncomeThresholdCents } =
    config.super.coContribution
  if (personalNonConcessionalCents <= 0) return 0
  if (totalIncomeCents >= higherIncomeThresholdCents) return 0
  const taper =
    (maxCents * (totalIncomeCents - lowerIncomeThresholdCents)) /
    (higherIncomeThresholdCents - lowerIncomeThresholdCents)
  const taperedMax = Math.min(maxCents, Math.max(0, maxCents - taper))
  return roundCents(Math.min(0.5 * personalNonConcessionalCents, taperedMax))
}

/**
 * Computes the full income-tax breakdown for a member's financial year. The
 * caller selects the `config` matching the member's residency and financial year.
 * Offsets reduce tax payable but not below zero, and never reduce the levies.
 * Concessional super contributions reduce taxable income (so they lower income
 * tax, LITO, and the Medicare levy) but are added back for the surcharge and HELP
 * repayment income, and may attract Division 293. When
 * `medicareLevySurchargeCentsOverride` is set, that surcharge is used in the line
 * and total in place of the per-person assessment, letting the household layer
 * assess the surcharge on combined family income.
 */
export function computeTax(input: TaxInput, config: TaxYearConfig): TaxBreakdown {
  const concessionalCents = input.concessionalContributionsCents ?? 0
  const taxableIncomeCents = taxableIncome(input)
  const incomeTaxCents = incomeTax(taxableIncomeCents, config)
  const litoOffsetCents = lowIncomeTaxOffset(taxableIncomeCents, config)
  const netIncomeTaxCents = Math.max(0, incomeTaxCents - litoOffsetCents)
  const medicareLevyCents = medicareLevy(taxableIncomeCents, config)
  // Reportable concessional contributions are added back for the surcharge and
  // HELP repayment income (they add back reportable super contributions).
  const incomeWithSuperCents = taxableIncomeCents + concessionalCents
  // The household layer may inject a family-income-assessed surcharge; otherwise
  // the surcharge is assessed per person from this member's income and cover.
  const medicareLevySurchargeCents =
    input.medicareLevySurchargeCentsOverride ??
    medicareLevySurcharge(incomeWithSuperCents, input.privateHospitalCover, config)
  const helpRepaymentCents = helpRepayment(incomeWithSuperCents, input.helpDebtCents, config)
  const division293Cents = division293(taxableIncomeCents, concessionalCents, config)
  const totalLiabilityCents =
    netIncomeTaxCents +
    medicareLevyCents +
    medicareLevySurchargeCents +
    helpRepaymentCents +
    division293Cents
  const balanceCents = totalLiabilityCents - input.paygWithheldCents
  return {
    taxableIncomeCents,
    incomeForSurchargeCents: incomeWithSuperCents,
    incomeTaxCents,
    litoOffsetCents,
    medicareLevyCents,
    medicareLevySurchargeCents,
    helpRepaymentCents,
    division293Cents,
    totalLiabilityCents,
    paygWithheldCents: input.paygWithheldCents,
    balanceCents,
  }
}
