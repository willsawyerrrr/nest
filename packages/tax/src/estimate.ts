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

import { computeTax } from './index'
import type { Money, Residency, TaxBreakdown, TaxInput, TaxYearConfig } from './index'

/** How often an income is received. Drives periods-per-year for annualisation. */
export type IncomeSchedule =
  'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'biannual' | 'annual'

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
}

/** A member's tax attributes: residency, private hospital cover, and HELP debt. */
export interface TaxProfileInput {
  readonly memberId: string
  readonly residency: Residency
  readonly privateHospitalCover: boolean
  readonly helpDebtCents: Money
}

/** A single member's annual and fortnightly estimate, with the full breakdown. */
export interface MemberTaxEstimate {
  readonly memberId: string
  readonly annualGrossCents: Money
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

/** Periods per year for each schedule. */
const PERIODS_PER_YEAR: Readonly<Record<IncomeSchedule, number>> = {
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
 * Annualises one income to whole cents. `salary` and `other` multiply their
 * per-period `amountCents` by the schedule's periods; `wage` first rounds
 * `hourlyRateCents × hoursPerPeriod` to whole cents of per-period pay, then
 * multiplies by the periods. Missing amounts are treated as zero.
 */
export function annualGrossCents(income: IncomeInput): Money {
  const periods = PERIODS_PER_YEAR[income.schedule]
  if (income.type === 'wage') {
    const perPeriod = Math.round((income.hourlyRateCents ?? 0) * (income.hoursPerPeriod ?? 0))
    return perPeriod * periods
  }
  return (income.amountCents ?? 0) * periods
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
 */
export function estimateHouseholdTax(
  incomes: readonly IncomeInput[],
  profiles: readonly TaxProfileInput[],
  config: TaxYearConfig,
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
    }
    const breakdown = computeTax(input, config)
    const annualGross = bucket.salaryOrWagesCents + bucket.otherCents
    const annualTax = breakdown.totalLiabilityCents
    const annualAfterTax = annualGross - annualTax
    return {
      memberId,
      annualGrossCents: annualGross,
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
