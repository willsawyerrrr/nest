/**
 * Shapes a household's raw rows into the `@nest/tax` engine's inputs and runs
 * the estimate — the slice of `apps/pwa/src/lib/tax.ts`'s
 * `estimateHouseholdTaxFromRows` that the buffer trigger needs.
 *
 * The Deno edge runtime cannot import the PWA's `lib/` (it pulls in React, the
 * Supabase client, and the generated database types), so the row shaping is
 * done here against loose row interfaces — exactly as `eofy-share/data.ts`
 * forwards raw rows for the PWA to shape its own way. The MATH is not
 * duplicated: brackets, LITO, the Medicare levy, HELP repayment, Division 293,
 * and the one-off concession all stay in `@nest/tax`'s `estimateHouseholdTax`.
 * The function names here mirror `lib/tax.ts` so the correspondence is legible.
 */

import { annualCents } from '@nest/plan'
import {
  annualGrossCents,
  estimateHouseholdTax,
  type HouseholdTaxEstimate,
  type IncomeInput,
  splitOneOffPayment,
  type TaxProfileInput,
  type TaxYearConfig,
} from '@nest/tax'

/** The `inflows` columns the estimate reads. */
export interface InflowRow {
  member_id: string | null
  taxable: boolean
  type: string
  schedule: string | null
  amount_cents: number | null
  hourly_rate_cents: number | null
  hours_per_period: number | null
  interval_count: number | null
  starts_on: string | null
  ends_on: string | null
  paid_on: string | null
  attracts_super: boolean
  one_off_tax_treatment: string | null
  years_of_service: number | null
  is_joint: boolean
  member_split_percent: number | null
}

/** The `tax_profile` columns the estimate reads. */
export interface TaxProfileRow {
  member_id: string
  residency: string
  has_private_hospital_cover: boolean
}

/** The `help_debt` columns the estimate reads. */
export interface HelpDebtRow {
  member_id: string
  balance_cents: number
}

/** The `deduction` columns the estimate reads. */
export interface DeductionRow {
  member_id: string
  amount_cents: number
}

/** The `super_contribution` columns the estimate reads. */
export interface SuperContributionRow {
  member_id: string
  kind: string
  mode: string
  amount_cents: number | null
  percent_bp: number | null
  frequency: string
  interval_count: number | null
}

/** The `members` columns the estimate reads (date of birth prices an ETP). */
export interface MemberRow {
  id: string
  date_of_birth: string | null
}

/** The tax engine's income types; any other inflow type is treated as `other`. */
const TAXABLE_INCOME_TYPES = new Set<IncomeInput['type']>(['salary', 'wage', 'other'])

/** Each stored tax treatment as the engine names it. */
const ENGINE_ONE_OFF_TREATMENTS: Record<string, IncomeInput['treatment']> = {
  ordinary: 'ordinary',
  genuine_redundancy: 'genuineRedundancy',
  employment_termination: 'employmentTermination',
  unused_leave: 'unusedLeave',
}

/** The contribution kinds that reduce taxable income (concessional super). */
const CONCESSIONAL_KINDS = new Set(['salary_sacrifice', 'personal_deductible'])

/**
 * Whether a member born on `dateOfBirth` had reached `config`'s preservation age
 * by `onDate` — which chooses between the two concessional rates on a
 * termination payment. An unknown date of birth reads as below it (the higher
 * rate), so a missing figure understates the payment, not the tax on it.
 */
export function atPreservationAgeOn(
  dateOfBirth: string | null,
  onDate: string,
  config: TaxYearConfig,
): boolean {
  if (dateOfBirth === null) return false
  const reached = new Date(`${dateOfBirth}T00:00:00Z`)
  reached.setUTCFullYear(reached.getUTCFullYear() + config.super.preservationAge)
  return new Date(`${onDate}T00:00:00Z`) >= reached
}

/** Maps an `inflow` row to the tax engine's `IncomeInput`. */
export function toIncomeInput(inflow: InflowRow, atPreservationAge = false): IncomeInput {
  const type = TAXABLE_INCOME_TYPES.has(inflow.type as IncomeInput['type'])
    ? (inflow.type as IncomeInput['type'])
    : 'other'
  return {
    memberId: inflow.member_id ?? '',
    type,
    ...(inflow.schedule != null && { schedule: inflow.schedule as IncomeInput['schedule'] }),
    ...(inflow.amount_cents != null && { amountCents: inflow.amount_cents }),
    ...(inflow.hourly_rate_cents != null && { hourlyRateCents: inflow.hourly_rate_cents }),
    ...(inflow.hours_per_period != null && { hoursPerPeriod: inflow.hours_per_period }),
    ...(inflow.interval_count != null && { interval: inflow.interval_count }),
    ...(inflow.starts_on != null && { startsOn: inflow.starts_on }),
    ...(inflow.ends_on != null && { endsOn: inflow.ends_on }),
    ...(inflow.paid_on != null && {
      paidOn: inflow.paid_on,
      treatment: ENGINE_ONE_OFF_TREATMENTS[inflow.one_off_tax_treatment ?? 'ordinary'] ??
        'ordinary',
      atPreservationAge,
      ...(inflow.years_of_service != null && { yearsOfService: inflow.years_of_service }),
    }),
  }
}

/**
 * The engine income inputs one taxable inflow contributes — the Deno mirror of
 * `lib/tax.ts`'s `inflowIncomeInputs`. A joint inflow (a recurring taxable
 * `other` inflow both partners are assessed on) yields two `other` inputs:
 * `member_split_percent`% of its annualised amount to `member_id` and the rest
 * to the household's other member, each keeping the inflow's effective window.
 * Anything else, or a member list that is not exactly the two members, maps to
 * one input assessed wholly to `member_id`.
 */
function inflowIncomeInputs(
  inflow: InflowRow,
  memberIds: readonly string[],
  atPreservationAge = false,
): IncomeInput[] {
  const base = toIncomeInput(inflow, atPreservationAge)
  const otherMemberId = memberIds.length === 2
    ? memberIds.find((id) => id !== inflow.member_id)
    : undefined
  if (!inflow.is_joint || inflow.member_split_percent == null || otherMemberId == null) {
    return [base]
  }
  const annual = annualGrossCents(base)
  const toMember = Math.round((annual * inflow.member_split_percent) / 100)
  const half = (memberId: string, amountCents: number): IncomeInput => ({
    memberId,
    type: 'other',
    schedule: 'annual',
    amountCents,
    ...(base.startsOn != null && { startsOn: base.startsOn }),
    ...(base.endsOn != null && { endsOn: base.endsOn }),
  })
  return [half(base.memberId, toMember), half(otherMemberId, annual - toMember)]
}

/** A member's tax profile as the engine's `TaxProfileInput`. */
function toTaxProfileInput(profile: TaxProfileRow, helpDebtCents: number): TaxProfileInput {
  return {
    memberId: profile.member_id,
    residency: profile.residency === 'foreign_resident' ? 'foreignResident' : 'resident',
    privateHospitalCover: profile.has_private_hospital_cover,
    helpDebtCents,
  }
}

/** Each member's HELP balance in cents, keyed by member id. */
function helpDebtCentsByMember(helpDebts: readonly HelpDebtRow[]): Map<string, number> {
  return new Map(helpDebts.map((debt) => [debt.member_id, debt.balance_cents]))
}

/** Each member's total annual deductions in cents. */
function deductionsByMember(deductions: readonly DeductionRow[]): Map<string, number> {
  const byMember = new Map<string, number>()
  for (const deduction of deductions) {
    byMember.set(
      deduction.member_id,
      (byMember.get(deduction.member_id) ?? 0) + deduction.amount_cents,
    )
  }
  return byMember
}

/** What one taxable inflow adds to a member's annual assessable income. */
function annualAssessableCents(
  inflow: InflowRow,
  income: IncomeInput,
  config: TaxYearConfig,
): number {
  if (inflow.paid_on == null) return annualGrossCents(income)
  return splitOneOffPayment(
    {
      treatment: ENGINE_ONE_OFF_TREATMENTS[inflow.one_off_tax_treatment ?? 'ordinary'] ??
        'ordinary',
      amountCents: annualGrossCents(income, config.financialYear),
      ...(inflow.years_of_service != null && { yearsOfService: inflow.years_of_service }),
    },
    0,
    config,
  ).assessableCents
}

/** Per-member annual ordinary time earnings — the base for percent-of-salary super. */
function grossByMemberFromInflows(
  inflows: readonly InflowRow[],
  config: TaxYearConfig,
): Map<string, number> {
  const byMember = new Map<string, number>()
  for (const inflow of inflows) {
    if (!inflow.taxable || !inflow.attracts_super || inflow.paid_on != null) continue
    const income = toIncomeInput(inflow)
    byMember.set(
      income.memberId,
      (byMember.get(income.memberId) ?? 0) + annualAssessableCents(inflow, income, config),
    )
  }
  return byMember
}

/** Each member's annual concessional super (salary sacrifice + personal deductible). */
function concessionalByMember(
  contributions: readonly SuperContributionRow[],
  grossByMember: ReadonlyMap<string, number>,
): Map<string, number> {
  const byMember = new Map<string, number>()
  for (const row of contributions) {
    if (!CONCESSIONAL_KINDS.has(row.kind)) continue
    const annual = row.mode === 'percent'
      ? Math.round(((row.percent_bp ?? 0) / 10_000) * (grossByMember.get(row.member_id) ?? 0))
      : annualCents(
        row.amount_cents ?? 0,
        row.frequency as Parameters<typeof annualCents>[1],
        row.interval_count ?? undefined,
      )
    byMember.set(row.member_id, (byMember.get(row.member_id) ?? 0) + annual)
  }
  return byMember
}

/** The rows a household tax estimate is built from. */
export interface TaxEstimateRows {
  inflows: readonly InflowRow[]
  taxProfiles: readonly TaxProfileRow[]
  contributions: readonly SuperContributionRow[]
  helpDebts: readonly HelpDebtRow[]
  deductions: readonly DeductionRow[]
  members: readonly MemberRow[]
}

/**
 * Estimates the household's tax for `config`'s financial year from raw rows —
 * the Deno mirror of `apps/pwa/src/lib/tax.ts`'s `estimateHouseholdTaxFromRows`.
 * Only taxable inflows feed it; a member with a HELP balance but no tax profile
 * still gets a default profile so their repayment is assessed.
 */
export function estimateHouseholdTaxFromRows(
  { inflows, taxProfiles, contributions, helpDebts, deductions, members }: TaxEstimateRows,
  config: TaxYearConfig,
): HouseholdTaxEstimate {
  const dateOfBirthByMember = new Map<string | null, string | null>(
    members.map((member) => [member.id, member.date_of_birth]),
  )
  const memberIds = members.map((member) => member.id)
  const incomes = inflows
    .filter((inflow) => inflow.taxable)
    .flatMap((inflow) =>
      inflowIncomeInputs(
        inflow,
        memberIds,
        inflow.paid_on != null &&
          atPreservationAgeOn(
            dateOfBirthByMember.get(inflow.member_id) ?? null,
            inflow.paid_on,
            config,
          ),
      )
    )
  const grossByMember = grossByMemberFromInflows(inflows, config)
  const helpByMember = helpDebtCentsByMember(helpDebts)
  const profileInputByMember = new Map(
    taxProfiles.map((profile) => [
      profile.member_id,
      toTaxProfileInput(profile, helpByMember.get(profile.member_id) ?? 0),
    ]),
  )
  for (const [memberId, helpDebtCents] of helpByMember) {
    if (helpDebtCents > 0 && !profileInputByMember.has(memberId)) {
      profileInputByMember.set(memberId, {
        memberId,
        residency: 'resident',
        privateHospitalCover: false,
        helpDebtCents,
      })
    }
  }
  return estimateHouseholdTax(
    incomes,
    [...profileInputByMember.values()],
    config,
    concessionalByMember(contributions, grossByMember),
    deductionsByMember(deductions),
  )
}
