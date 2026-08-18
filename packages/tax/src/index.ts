/**
 * Shared, framework-agnostic tax domain. Imported by the PWA (for instant
 * client-side preview) and by the Supabase edge function (authoritative), so the
 * computation lives in exactly one place. Pure — no I/O, no side effects.
 */

import type { OneOffConcession } from './oneOff'

export { FY2026_CONFIG, FY2027_CONFIG, configsByYear } from './configs'

export { annualGrossCents, estimateHouseholdTax } from './estimate'
export type {
  HouseholdTaxEstimate,
  IncomeInput,
  IncomeSchedule,
  MemberTaxEstimate,
  TaxProfileInput,
} from './estimate'

export { splitOneOffPayment } from './oneOff'
export type {
  OneOffConcession,
  OneOffPaymentInput,
  OneOffPaymentSplit,
  OneOffTaxTreatment,
} from './oneOff'

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
  /**
   * Annual HELP/HECS indexation rate applied to the outstanding balance on 1 June
   * (the minimum of the CPI and WPI movements). Drives the payoff projection; not
   * used by a single-year `computeTax`, which assesses a balance already indexed.
   */
  readonly indexationRate: number
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
  readonly employmentTermination: EmploymentTerminationConfig
  readonly carExpense: CarExpenseConfig
}

/**
 * Employment-termination concession parameters: the caps that bound how much of a
 * termination payment is taxed concessionally, the rates it is taxed at, and the
 * genuine-redundancy tax-free amount.
 *
 * Every rate here **excludes** the 2% Medicare levy. The ATO quotes the
 * concessional rates as 32% / 17% / 47% and the unused-leave maximum as 32%; each
 * of those is the rate below **plus** the levy. The concessional part of a payment
 * sits in taxable income, so `medicareLevy` already charges the levy on it, and
 * repeating it here would charge it twice.
 */
export interface EmploymentTerminationConfig {
  /**
   * ETP cap: the most of one payment that can be taxed at the concessional rate.
   * Indexed annually.
   */
  readonly capCents: Money
  /**
   * Whole-of-income cap. A payment that is NOT an excluded payment is concessional
   * only up to this cap less the member's other taxable income for the year, so a
   * high salary can exhaust the headroom entirely. Not indexed.
   */
  readonly wholeOfIncomeCapCents: Money
  /** Concessional rate for a member below preservation age on the payment date. */
  readonly belowPreservationAgeRate: number
  /** Concessional rate for a member at or above preservation age on the payment date. */
  readonly atPreservationAgeRate: number
  /**
   * Rate the ATO charges on the part of a payment above the cap. The top marginal
   * bracket reaches the same rate at the incomes at which the cap binds, so
   * `splitOneOffPayment` leaves that part to the brackets rather than counting it
   * concessional; the figure is stated here so the config carries the whole
   * schedule.
   */
  readonly aboveCapRate: number
  /** Maximum rate on unused leave paid out on a genuine redundancy. */
  readonly unusedLeaveMaxRate: number
  readonly genuineRedundancy: GenuineRedundancyConfig
}

/**
 * The genuine-redundancy tax-free amount: `baseLimitCents` plus
 * `perYearOfServiceCents` for every completed year of service. That amount is
 * excluded from assessable income entirely. Both figures are indexed annually.
 */
export interface GenuineRedundancyConfig {
  readonly baseLimitCents: Money
  readonly perYearOfServiceCents: Money
}

/**
 * ATO cents-per-kilometre car expense deduction parameters. `centsPerKm` is a
 * rate in whole cents (e.g. `88` means $0.88/km), not a `Money` amount, so a
 * deduction claimed as `distanceKm` kilometres converts to
 * `round(distanceKm * centsPerKm)` integer cents. `maxClaimableKm` is the ATO's
 * cap on work-related kilometres claimable per car per year under this method.
 */
export interface CarExpenseConfig {
  readonly centsPerKm: number
  readonly maxClaimableKm: number
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
  /**
   * The assessable part of every one-off payment the member received in the year,
   * summed — a termination payment's excess over its tax-free amount, an unused-leave
   * payout, or an ordinary bonus in full. It is assessable income like any other, so
   * it lifts income for the LITO taper, the Medicare levy, the surcharge, HELP
   * repayment income, and Division 293, all of which assess taxable income. The
   * concession such a payment carries is delivered as an offset
   * (`oneOffOffsetCents`), never by holding the payment out of income.
   */
  readonly employmentTerminationCents: Money
}

/** A member's figures for one financial year, paired with a `TaxYearConfig`. */
export interface TaxInput {
  readonly assessableIncome: AssessableIncome
  readonly deductionsCents: Money
  readonly residency: Residency
  /** Whether private hospital cover is held; exempts the surcharge when true. */
  readonly privateHospitalCover: boolean
  readonly helpDebtCents: Money
  /**
   * Tax withheld against the year's liability, summed from the member's payslips:
   * each slip's whole tax total, PAYG income tax **plus** any STSL study-loan
   * withholding. `totalLiabilityCents` includes the compulsory HELP repayment the
   * STSL pays, so netting the PAYG line alone would overstate `balanceCents` by
   * every dollar of STSL withheld.
   */
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
  /**
   * The already-split concessional parts of the member's one-off payments, in
   * payment order, each with the capped rate it bears. `computeTax` turns them into
   * `oneOffOffsetCents`; absent is treated as none. Split them with
   * `splitOneOffPayment`, whose `assessableCents` belongs in
   * `assessableIncome.employmentTerminationCents` for the same payment.
   */
  readonly oneOffConcessions?: readonly OneOffConcession[]
}

/**
 * A full liability breakdown, every field an integer cent amount. `incomeTaxCents`
 * is gross tax on the brackets, with `litoOffsetCents` and `oneOffOffsetCents` the
 * offsets applied against it; `totalLiabilityCents` nets both (floored at zero)
 * before adding the levies, repayment, and Division 293. `balanceCents` is positive
 * when owing, negative for an estimated refund. `division293Cents` is the extra tax
 * on concessional contributions for high earners (nil for most).
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
  /**
   * The employment-termination concession offset, bringing the effective tax on each
   * concessional amount down to its capped rate. Non-refundable: it is applied
   * alongside LITO against income tax, floored at zero with it, so it can never
   * create a refund on its own, and it leaves the Medicare levy untouched — the levy
   * is charged on the concessional amount as on any other taxable income, which is
   * why the config's rates exclude it.
   */
  readonly oneOffOffsetCents: Money
  readonly medicareLevyCents: Money
  readonly medicareLevySurchargeCents: Money
  readonly helpRepaymentCents: Money
  readonly division293Cents: Money
  readonly totalLiabilityCents: Money
  readonly paygWithheldCents: Money
  readonly balanceCents: Money
  /**
   * Repayment income the HELP/HECS repayment is assessed on — taxable income plus
   * reportable concessional super contributions. Surfaced so the payoff projection
   * can hold it constant across future years.
   */
  readonly repaymentIncomeCents: Money
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
 * Whether an ISO date (`YYYY-MM-DD`) falls within `financialYear`, both bounds
 * inclusive. A payment that lands on a single day is counted by this test rather
 * than prorated, so it belongs wholly to one financial year or to none.
 */
export function isDateInFinancialYear(iso: string, financialYear: FinancialYear): boolean {
  const { start, end } = financialYearBounds(financialYear)
  const date = isoDateToUtc(iso)
  return date >= start && date <= end
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
 * The dollar deduction for a work-related car expense claimed under the ATO's
 * cents-per-kilometre method: `distanceKm` kilometres at `config.carExpense`'s
 * rate, rounded to the nearest whole cent. Never negative; a negative
 * `distanceKm` is treated as zero.
 */
export function carExpenseDeductionCents(distanceKm: number, config: TaxYearConfig): Money {
  return roundCents(Math.max(0, distanceKm) * config.carExpense.centsPerKm)
}

/**
 * Taxable income = total assessable income − deductions − concessional super
 * contributions, floored at zero. Salary sacrifice and personal deductible
 * contributions both reduce assessable income, so they are subtracted here.
 */
export function taxableIncome(input: TaxInput): Money {
  const {
    salaryOrWagesCents,
    businessCents,
    investmentCents,
    otherCents,
    employmentTerminationCents,
  } = input.assessableIncome
  const assessable =
    salaryOrWagesCents + businessCents + investmentCents + otherCents + employmentTerminationCents
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
 * The offset that brings the effective tax on each concessional amount down to its
 * capped rate, by the ATO's difference method: the marginal tax the amount attracts
 * where it sits in the member's income, less what the capped rate charges on it.
 *
 * Concessions are peeled off the top of `taxableIncomeCents` in order, so each is
 * measured against the income actually sitting under it rather than against the same
 * top slice twice. Each is floored at zero: a capped rate at or above the member's
 * marginal rate leaves the marginal rate standing rather than yielding a negative
 * offset that would subsidise the rest of their income.
 */
export function oneOffConcessionOffset(
  taxableIncomeCents: Money,
  concessions: readonly OneOffConcession[],
  config: TaxYearConfig,
): Money {
  let topCents = taxableIncomeCents
  let offsetCents = 0
  for (const concession of concessions) {
    const underCents = Math.max(0, topCents - concession.concessionalCents)
    const marginalCents = incomeTax(topCents, config) - incomeTax(underCents, config)
    const cappedCents = roundCents(concession.concessionalCents * concession.rate)
    offsetCents += Math.max(0, marginalCents - cappedCents)
    topCents = underCents
  }
  return offsetCents
}

/**
 * Computes the full income-tax breakdown for a member's financial year. The
 * caller selects the `config` matching the member's residency and financial year.
 * Offsets reduce tax payable but not below zero, and never reduce the levies.
 * Concessional super contributions reduce taxable income (so they lower income
 * tax, LITO, and the Medicare levy) but are added back for the surcharge and HELP
 * repayment income, and may attract Division 293. `oneOffConcessions` become the
 * employment-termination offset, applied alongside LITO against income tax and
 * floored at zero with it. When `medicareLevySurchargeCentsOverride` is set, that
 * surcharge is used in the line and total in place of the per-person assessment,
 * letting the household layer assess the surcharge on combined family income.
 */
export function computeTax(input: TaxInput, config: TaxYearConfig): TaxBreakdown {
  const concessionalCents = input.concessionalContributionsCents ?? 0
  const taxableIncomeCents = taxableIncome(input)
  const incomeTaxCents = incomeTax(taxableIncomeCents, config)
  const litoOffsetCents = lowIncomeTaxOffset(taxableIncomeCents, config)
  const oneOffOffsetCents = oneOffConcessionOffset(
    taxableIncomeCents,
    input.oneOffConcessions ?? [],
    config,
  )
  const netIncomeTaxCents = Math.max(0, incomeTaxCents - litoOffsetCents - oneOffOffsetCents)
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
    oneOffOffsetCents,
    medicareLevyCents,
    medicareLevySurchargeCents,
    helpRepaymentCents,
    division293Cents,
    totalLiabilityCents,
    paygWithheldCents: input.paygWithheldCents,
    balanceCents,
    repaymentIncomeCents: incomeWithSuperCents,
  }
}

/**
 * The trade-off of directing `additionalConcessionalCents` more of a member's
 * pre-tax income into super, over their current position. Salary sacrifice cuts
 * taxable income — saving marginal tax plus any Division 293 the extra
 * contribution itself attracts — but the diverted cash is taxed 15% in the fund
 * and no longer lands as take-home, so the net cash change is the tax saved less
 * the whole amount sacrificed. Every field is an integer cent amount.
 */
export interface SalarySacrificeWhatIf {
  readonly additionalConcessionalCents: Money
  /** Baseline total liability less the modified total liability; includes any Division 293 rise. */
  readonly taxSavedCents: Money
  /** The 15% contributions tax the extra sacrifice attracts inside the fund. */
  readonly contributionsTaxCents: Money
  /** What of the extra sacrifice lands in the fund, net of the 15% contributions tax. */
  readonly netToSuperCents: Money
  /**
   * Signed change in take-home cash: tax saved less the amount sacrificed.
   * Negative when the cash forgone now exceeds the tax saved.
   */
  readonly takeHomeChangeCents: Money
  /** Extra Division 293 the additional contribution attracts: modified less baseline, never below zero. */
  readonly division293DeltaCents: Money
}

/**
 * Compares a member's `input` against the same input with
 * `additionalConcessionalCents` more concessional super, diffing the total
 * liability and Division 293 tax. Pure and integer-cent: `contributionsTaxCents`
 * is the additional amount at `config.super.contributionsTaxRate`,
 * `netToSuperCents` the remainder, `takeHomeChangeCents` the tax saved less the
 * amount sacrificed.
 */
export function salarySacrificeWhatIf(
  input: TaxInput,
  additionalConcessionalCents: Money,
  config: TaxYearConfig,
): SalarySacrificeWhatIf {
  const baseline = computeTax(input, config)
  const modified = computeTax(
    {
      ...input,
      concessionalContributionsCents:
        (input.concessionalContributionsCents ?? 0) + additionalConcessionalCents,
    },
    config,
  )
  const taxSavedCents = baseline.totalLiabilityCents - modified.totalLiabilityCents
  const contributionsTaxCents = roundCents(
    additionalConcessionalCents * config.super.contributionsTaxRate,
  )
  return {
    additionalConcessionalCents,
    taxSavedCents,
    contributionsTaxCents,
    netToSuperCents: additionalConcessionalCents - contributionsTaxCents,
    takeHomeChangeCents: taxSavedCents - additionalConcessionalCents,
    division293DeltaCents: modified.division293Cents - baseline.division293Cents,
  }
}

/** One financial year in a HELP/HECS payoff projection. */
export interface HelpPayoffYear {
  readonly financialYear: FinancialYear
  readonly openingBalanceCents: Money
  readonly indexationCents: Money
  readonly repaymentCents: Money
  readonly closingBalanceCents: Money
}

/**
 * A projection of when a HELP/HECS debt clears. `paidOffFinancialYear` and
 * `yearsToPayOff` are null when the debt is not cleared within the horizon — either
 * because the repayment never outpaces indexation, or because `maxYears` is reached
 * first. `schedule` lists each modelled year in order.
 */
export interface HelpPayoffProjection {
  readonly paidOffFinancialYear: FinancialYear | null
  readonly yearsToPayOff: number | null
  readonly schedule: readonly HelpPayoffYear[]
}

/**
 * Projects when a HELP/HECS debt is paid off, holding `repaymentIncomeCents`
 * constant (an estimate — real repayment income varies year to year). Each year
 * follows the ATO order of operations: the balance is indexed on 1 June (at
 * `config.helpRepayment.indexationRate`) BEFORE that year's compulsory repayment
 * is credited. `config` is reused for every future year, since only the current
 * financial year's config is published.
 *
 * A balance at or below zero returns an empty schedule with zero years. Otherwise,
 * for each year from `startFinancialYear`, the opening balance is indexed, the
 * repayment is computed against the indexed balance and subtracted (floored at
 * zero), and the year is recorded. The projection stops when the balance clears
 * (paid off that year) or when a year's closing balance does not fall below its
 * opening balance (indexation outpaces repayment, so it never clears), and runs
 * for at most `maxYears`.
 */
export function projectHelpPayoff(
  balanceCents: Money,
  repaymentIncomeCents: Money,
  config: TaxYearConfig,
  startFinancialYear: FinancialYear,
  maxYears = 40,
): HelpPayoffProjection {
  if (balanceCents <= 0) {
    return { paidOffFinancialYear: null, yearsToPayOff: 0, schedule: [] }
  }
  const schedule: HelpPayoffYear[] = []
  let balance = balanceCents
  for (let i = 0; i < maxYears; i++) {
    const financialYear = startFinancialYear + i
    const openingBalanceCents = balance
    const indexationCents = roundCents(openingBalanceCents * config.helpRepayment.indexationRate)
    const indexedCents = openingBalanceCents + indexationCents
    const repaymentCents = helpRepayment(repaymentIncomeCents, indexedCents, config)
    const closingBalanceCents = Math.max(0, indexedCents - repaymentCents)
    schedule.push({
      financialYear,
      openingBalanceCents,
      indexationCents,
      repaymentCents,
      closingBalanceCents,
    })
    if (closingBalanceCents <= 0) {
      return { paidOffFinancialYear: financialYear, yearsToPayOff: i + 1, schedule }
    }
    if (closingBalanceCents >= openingBalanceCents) {
      return { paidOffFinancialYear: null, yearsToPayOff: null, schedule }
    }
    balance = closingBalanceCents
  }
  return { paidOffFinancialYear: null, yearsToPayOff: null, schedule }
}
