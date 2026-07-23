/**
 * Household tax-estimate layer over the pure per-person engine. Turns a
 * household's projection-based incomes into annual and fortnightly gross, tax,
 * and after-tax figures per member and for the household as a whole.
 *
 * DB-independent by design: the PWA maps database rows to these domain inputs;
 * this package imports nothing from the database or the PWA and stays pure.
 * Estimate-only — PAYG withheld is taken as nil, so figures are liabilities
 * rather than balances owing.
 */

import {
  activeFractionOfFinancialYear,
  computeTax,
  type Money,
  type Residency,
  type TaxBreakdown,
  type TaxInput,
  type TaxYearConfig,
} from './index'

/**
 * How often an income is received. Drives periods-per-year for annualisation.
 * `every_n_weeks` and `every_n_months` are arbitrary cadences — received once
 * every N weeks or N months — each carrying its interval N in `interval` rather
 * than a fixed periods/year.
 */
export type IncomeSchedule =
  | 'weekly'
  | 'fortnightly'
  | 'monthly'
  | 'quarterly'
  | 'biannual'
  | 'annual'
  | 'every_n_weeks'
  | 'every_n_months'

/**
 * One projection-based income, tagged to a member. `salary` and `other` carry a
 * gross `amountCents` per period; `wage` carries an `hourlyRateCents` and the
 * `hoursPerPeriod` worked in each period.
 */
export interface IncomeInput {
  readonly memberId: string
  readonly type: 'salary' | 'wage' | 'other'
  readonly schedule: IncomeSchedule
  readonly amountCents?: Money
  readonly hourlyRateCents?: Money
  readonly hoursPerPeriod?: number
  /**
   * The interval N, required only for the `every_n_weeks`/`every_n_months`
   * schedules: received once every N weeks or N months, the unit read from
   * `schedule`.
   */
  readonly interval?: number
  /**
   * First day the income is active (ISO `YYYY-MM-DD`); absent means from the
   * start of the financial year. Prorates the assessable figure by calendar days.
   */
  readonly startsOn?: string
  /**
   * Last day the income is active (ISO `YYYY-MM-DD`); absent means through the
   * end of the financial year. Prorates the assessable figure by calendar days.
   */
  readonly endsOn?: string
}

/** A member's tax attributes: residency, private hospital cover, and HELP debt. */
export interface TaxProfileInput {
  readonly memberId: string
  readonly residency: Residency
  readonly privateHospitalCover: boolean
  readonly helpDebtCents: Money
}

/**
 * A single member's annual and fortnightly estimate, with the full breakdown.
 * `annualConcessionalContributionsCents` is the pre-tax super diverted from cash;
 * after-tax figures are gross less those contributions less tax, so they reflect
 * the cash actually available to budget. `annualNetConcessionalSuperCents` is what
 * of those contributions lands in the fund after the 15% contributions tax — the
 * beneficial amount actually saved into super.
 */
export interface MemberTaxEstimate {
  readonly memberId: string
  readonly annualGrossCents: Money
  readonly annualConcessionalContributionsCents: Money
  readonly annualNetConcessionalSuperCents: Money
  /** Annual work-related deductions reducing taxable income only (not after-tax cash). */
  readonly annualDeductionsCents: Money
  readonly annualTaxCents: Money
  readonly annualAfterTaxCents: Money
  readonly fortnightlyGrossCents: Money
  readonly fortnightlyTaxCents: Money
  readonly fortnightlyAfterTaxCents: Money
  readonly breakdown: TaxBreakdown
  /** The engine input the breakdown was computed from, for re-running what-ifs (e.g. salary sacrifice). */
  readonly input: TaxInput
}

/** The household total, with each field the sum of its members' fields. */
export interface HouseholdTaxEstimate {
  readonly members: readonly MemberTaxEstimate[]
  readonly annualGrossCents: Money
  readonly annualConcessionalContributionsCents: Money
  readonly annualNetConcessionalSuperCents: Money
  readonly annualDeductionsCents: Money
  readonly annualTaxCents: Money
  readonly annualAfterTaxCents: Money
  readonly fortnightlyGrossCents: Money
  readonly fortnightlyTaxCents: Money
  readonly fortnightlyAfterTaxCents: Money
}

/** Fortnights per financial year; annual figures divide by this. */
const FORTNIGHTS_PER_YEAR = 26

/** Weeks per year; the `every_n_weeks` cadence divides this by its interval. */
const WEEKS_PER_YEAR = 52

/** Months per year; the `every_n_months` cadence divides this by its interval. */
const MONTHS_PER_YEAR = 12

/** Periods per year for each fixed-cadence schedule. */
const PERIODS_PER_YEAR: Readonly<
  Record<Exclude<IncomeSchedule, 'every_n_weeks' | 'every_n_months'>, number>
> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  biannual: 2,
  annual: 1,
}

/** Profile applied to a member who has income but no explicit tax profile. */
const DEFAULT_PROFILE: Omit<TaxProfileInput, 'memberId'> = {
  residency: 'resident',
  privateHospitalCover: false,
  helpDebtCents: 0,
}

/** Converts an annual cent figure to its per-fortnight share, to whole cents. */
function fortnightlyOf(annualCents: Money): Money {
  return Math.round(annualCents / FORTNIGHTS_PER_YEAR)
}

/**
 * Annualises one income to whole cents. The per-period gross is `amountCents`
 * for `salary` and `other`, or `hourlyRateCents × hoursPerPeriod` rounded to
 * whole cents for `wage`. Fixed schedules multiply that by the schedule's
 * periods per year; `every_n_weeks` — a per-period gross received once every
 * `interval` weeks — is `round(perPeriod × 52 / interval)`, and `every_n_months`
 * — once every `interval` months — is `round(perPeriod × 12 / interval)`, with
 * an absent or non-positive-integer interval defensively annualising to zero.
 * Missing amounts are treated as zero.
 */
export function annualGrossCents(income: IncomeInput): Money {
  const perPeriod =
    income.type === 'wage'
      ? Math.round((income.hourlyRateCents ?? 0) * (income.hoursPerPeriod ?? 0))
      : (income.amountCents ?? 0)
  const interval = income.interval
  const hasValidInterval = interval !== undefined && Number.isInteger(interval) && interval >= 1
  if (income.schedule === 'every_n_weeks') {
    if (!hasValidInterval) {
      return 0
    }
    return Math.round((perPeriod * WEEKS_PER_YEAR) / interval)
  }
  if (income.schedule === 'every_n_months') {
    if (!hasValidInterval) {
      return 0
    }
    return Math.round((perPeriod * MONTHS_PER_YEAR) / interval)
  }
  return perPeriod * PERIODS_PER_YEAR[income.schedule]
}

/** Members' income streams split into the engine's salary/wages and other buckets. */
interface MemberIncome {
  salaryOrWagesCents: Money
  otherCents: Money
}

/**
 * Estimates the household's tax. Incomes are grouped by member and annualised —
 * `salary` and `wage` feed the salary/wages assessable component, `other` the
 * "other" component — each prorated by the fraction of `config.financialYear`
 * its effective `startsOn`/`endsOn` window is active, then run through the
 * per-person engine with deductions and PAYG withheld nil (estimate-only). A
 * member with income but no profile is
 * treated as a cover-less resident with no HELP debt; a member with a profile but
 * no income yields a zero estimate. Household fields are the sum of members'.
 * `concessionalByMember`, when supplied, gives each member's annual concessional
 * super contributions — reducing taxable income and the after-tax cash available.
 * `deductionsByMember`, when supplied, gives each member's annual work-related
 * deductions — reducing taxable income only, so tax falls and after-tax cash
 * rises; the diverted cash of a concessional contribution has no counterpart here.
 */
export function estimateHouseholdTax(
  incomes: readonly IncomeInput[],
  profiles: readonly TaxProfileInput[],
  config: TaxYearConfig,
  concessionalByMember?: ReadonlyMap<string, Money>,
  deductionsByMember?: ReadonlyMap<string, Money>,
): HouseholdTaxEstimate {
  const incomeByMember = new Map<string, MemberIncome>()
  const memberOrder: string[] = []
  const seen = new Set<string>()
  const note = (memberId: string): MemberIncome => {
    if (!seen.has(memberId)) {
      seen.add(memberId)
      memberOrder.push(memberId)
    }
    let bucket = incomeByMember.get(memberId)
    if (!bucket) {
      bucket = { salaryOrWagesCents: 0, otherCents: 0 }
      incomeByMember.set(memberId, bucket)
    }
    return bucket
  }

  for (const income of incomes) {
    const bucket = note(income.memberId)
    // Prorate the steady-rate annual gross by the share of the financial year the
    // income is active, so income that starts, ends, or changes mid-year (a pay
    // rise modelled as two dated inflows) contributes only its part-year amount.
    const activeFraction = activeFractionOfFinancialYear(
      income.startsOn,
      income.endsOn,
      config.financialYear,
    )
    const annual = Math.round(annualGrossCents(income) * activeFraction)
    if (income.type === 'other') {
      bucket.otherCents += annual
    } else {
      bucket.salaryOrWagesCents += annual
    }
  }

  const profileByMember = new Map(profiles.map((profile) => [profile.memberId, profile]))
  for (const profile of profiles) note(profile.memberId)

  const members = memberOrder.map((memberId) => {
    // Every id in `memberOrder` was appended by `note()`, which always writes an
    // `incomeByMember` bucket in the same call, so the fallback is unreachable.
    /* v8 ignore next */
    const bucket = incomeByMember.get(memberId) ?? { salaryOrWagesCents: 0, otherCents: 0 }
    const profile = profileByMember.get(memberId) ?? { memberId, ...DEFAULT_PROFILE }
    const concessionalCents = concessionalByMember?.get(memberId) ?? 0
    const deductionsCents = deductionsByMember?.get(memberId) ?? 0
    const input: TaxInput = {
      assessableIncome: {
        salaryOrWagesCents: bucket.salaryOrWagesCents,
        businessCents: 0,
        investmentCents: 0,
        otherCents: bucket.otherCents,
      },
      deductionsCents,
      residency: profile.residency,
      privateHospitalCover: profile.privateHospitalCover,
      helpDebtCents: profile.helpDebtCents,
      paygWithheldCents: 0,
      concessionalContributionsCents: concessionalCents,
    }
    const breakdown = computeTax(input, config)
    const annualGross = bucket.salaryOrWagesCents + bucket.otherCents
    const annualTax = breakdown.totalLiabilityCents
    // After-tax cash excludes concessional super (diverted from cash to the fund).
    const annualAfterTax = annualGross - concessionalCents - annualTax
    // What of the concessional super lands in the fund after the 15% contributions
    // tax — the amount actually saved, not the pre-tax amount diverted from cash.
    const netConcessionalCents = Math.round(
      concessionalCents * (1 - config.super.contributionsTaxRate),
    )
    return {
      memberId,
      annualGrossCents: annualGross,
      annualConcessionalContributionsCents: concessionalCents,
      annualNetConcessionalSuperCents: netConcessionalCents,
      annualDeductionsCents: deductionsCents,
      annualTaxCents: annualTax,
      annualAfterTaxCents: annualAfterTax,
      fortnightlyGrossCents: fortnightlyOf(annualGross),
      fortnightlyTaxCents: fortnightlyOf(annualTax),
      fortnightlyAfterTaxCents: fortnightlyOf(annualAfterTax),
      breakdown,
      input,
    } satisfies MemberTaxEstimate
  })

  const sum = (pick: (member: MemberTaxEstimate) => Money): Money =>
    members.reduce((total, member) => total + pick(member), 0)

  return {
    members,
    annualGrossCents: sum((member) => member.annualGrossCents),
    annualConcessionalContributionsCents: sum(
      (member) => member.annualConcessionalContributionsCents,
    ),
    annualNetConcessionalSuperCents: sum((member) => member.annualNetConcessionalSuperCents),
    annualDeductionsCents: sum((member) => member.annualDeductionsCents),
    annualTaxCents: sum((member) => member.annualTaxCents),
    annualAfterTaxCents: sum((member) => member.annualAfterTaxCents),
    fortnightlyGrossCents: sum((member) => member.fortnightlyGrossCents),
    fortnightlyTaxCents: sum((member) => member.fortnightlyTaxCents),
    fortnightlyAfterTaxCents: sum((member) => member.fortnightlyAfterTaxCents),
  }
}
