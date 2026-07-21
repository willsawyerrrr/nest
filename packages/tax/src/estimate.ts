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
  computeTax,
  type Money,
  type Residency,
  type TaxBreakdown,
  type TaxInput,
  type TaxYearConfig,
} from './index'

/**
 * How often an income is received. Drives periods-per-year for annualisation.
 * `every_n_weeks` is an arbitrary cadence — received once every N weeks —
 * carrying its interval N in `intervalWeeks` rather than a fixed periods/year.
 */
export type IncomeSchedule =
  'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'biannual' | 'annual' | 'every_n_weeks'

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
  /** Weeks between payments, required only when `schedule` is `every_n_weeks`. */
  readonly intervalWeeks?: number
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
 * the cash actually available to budget.
 */
export interface MemberTaxEstimate {
  readonly memberId: string
  readonly annualGrossCents: Money
  readonly annualConcessionalContributionsCents: Money
  readonly annualTaxCents: Money
  readonly annualAfterTaxCents: Money
  readonly fortnightlyGrossCents: Money
  readonly fortnightlyTaxCents: Money
  readonly fortnightlyAfterTaxCents: Money
  readonly breakdown: TaxBreakdown
}

/** The household total, with each field the sum of its members' fields. */
export interface HouseholdTaxEstimate {
  readonly members: readonly MemberTaxEstimate[]
  readonly annualGrossCents: Money
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

/** Periods per year for each fixed-cadence schedule. */
const PERIODS_PER_YEAR: Readonly<Record<Exclude<IncomeSchedule, 'every_n_weeks'>, number>> = {
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
 * `intervalWeeks` weeks — is `round(perPeriod × 52 / intervalWeeks)`, with an
 * absent or non-positive-integer interval defensively annualising to zero.
 * Missing amounts are treated as zero.
 */
export function annualGrossCents(income: IncomeInput): Money {
  const perPeriod =
    income.type === 'wage'
      ? Math.round((income.hourlyRateCents ?? 0) * (income.hoursPerPeriod ?? 0))
      : (income.amountCents ?? 0)
  if (income.schedule === 'every_n_weeks') {
    const interval = income.intervalWeeks
    if (interval === undefined || !Number.isInteger(interval) || interval < 1) {
      return 0
    }
    return Math.round((perPeriod * WEEKS_PER_YEAR) / interval)
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
 * "other" component — then run through the per-person engine with deductions and
 * PAYG withheld nil (estimate-only). A member with income but no profile is
 * treated as a cover-less resident with no HELP debt; a member with a profile but
 * no income yields a zero estimate. Household fields are the sum of members'.
 * `concessionalByMember`, when supplied, gives each member's annual concessional
 * super contributions — reducing taxable income and the after-tax cash available.
 */
export function estimateHouseholdTax(
  incomes: readonly IncomeInput[],
  profiles: readonly TaxProfileInput[],
  config: TaxYearConfig,
  concessionalByMember?: ReadonlyMap<string, Money>,
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
    const annual = annualGrossCents(income)
    if (income.type === 'other') {
      bucket.otherCents += annual
    } else {
      bucket.salaryOrWagesCents += annual
    }
  }

  const profileByMember = new Map(profiles.map((profile) => [profile.memberId, profile]))
  for (const profile of profiles) note(profile.memberId)

  const members = memberOrder.map((memberId) => {
    const bucket = incomeByMember.get(memberId) ?? { salaryOrWagesCents: 0, otherCents: 0 }
    const profile = profileByMember.get(memberId) ?? { memberId, ...DEFAULT_PROFILE }
    const concessionalCents = concessionalByMember?.get(memberId) ?? 0
    const input: TaxInput = {
      assessableIncome: {
        salaryOrWagesCents: bucket.salaryOrWagesCents,
        businessCents: 0,
        investmentCents: 0,
        otherCents: bucket.otherCents,
      },
      deductionsCents: 0,
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
    return {
      memberId,
      annualGrossCents: annualGross,
      annualConcessionalContributionsCents: concessionalCents,
      annualTaxCents: annualTax,
      annualAfterTaxCents: annualAfterTax,
      fortnightlyGrossCents: fortnightlyOf(annualGross),
      fortnightlyTaxCents: fortnightlyOf(annualTax),
      fortnightlyAfterTaxCents: fortnightlyOf(annualAfterTax),
      breakdown,
    } satisfies MemberTaxEstimate
  })

  const sum = (pick: (member: MemberTaxEstimate) => Money): Money =>
    members.reduce((total, member) => total + pick(member), 0)

  return {
    members,
    annualGrossCents: sum((member) => member.annualGrossCents),
    annualTaxCents: sum((member) => member.annualTaxCents),
    annualAfterTaxCents: sum((member) => member.annualAfterTaxCents),
    fortnightlyGrossCents: sum((member) => member.fortnightlyGrossCents),
    fortnightlyTaxCents: sum((member) => member.fortnightlyTaxCents),
    fortnightlyAfterTaxCents: sum((member) => member.fortnightlyAfterTaxCents),
  }
}
