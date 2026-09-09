/**
 * Maps a household `inflow` row to the `@nest/tax` engine's `IncomeInput`,
 * including the joint-inflow split, and the cent-splitting helpers the split and
 * the pooled-money attribution use.
 */

import { annualGrossCents, type IncomeInput, type IncomeSchedule } from '@nest/tax'
import type { InflowRow } from '../rows.ts'
import { engineOneOffTreatment } from './oneOff.ts'

/** The tax engine's income types; any other inflow type is treated as `other`. */
const TAXABLE_INCOME_TYPES = new Set<IncomeInput['type']>(['salary', 'wage', 'other'])

/**
 * Maps an `inflow` row to the tax engine's `IncomeInput`. Only taxable inflows reach
 * the tax estimate, so the type is only ever salary, wage, or other; any non-taxable
 * label is coerced to `other` for safety.
 *
 * A ONE-OFF carries `paidOn` and the concession it is assessed under in place of a
 * cadence, which is what tells the engine to count its whole amount in the year that
 * date falls in rather than annualising anything. `atPreservationAge` is the
 * member's age at that date decided by the caller (see {@link atPreservationAgeOn}),
 * defaulting to the higher-rate reading.
 */
export function toIncomeInput(inflow: InflowRow, atPreservationAge = false): IncomeInput {
  return {
    memberId: inflow.member_id ?? '',
    type: TAXABLE_INCOME_TYPES.has(inflow.type as IncomeInput['type'])
      ? (inflow.type as IncomeInput['type'])
      : 'other',
    ...(inflow.schedule != null && { schedule: inflow.schedule as IncomeSchedule }),
    ...(inflow.amount_cents != null && { amountCents: inflow.amount_cents }),
    ...(inflow.hourly_rate_cents != null && { hourlyRateCents: inflow.hourly_rate_cents }),
    ...(inflow.hours_per_period != null && { hoursPerPeriod: inflow.hours_per_period }),
    ...(inflow.interval_count != null && { interval: inflow.interval_count }),
    ...(inflow.starts_on != null && { startsOn: inflow.starts_on }),
    ...(inflow.ends_on != null && { endsOn: inflow.ends_on }),
    ...(inflow.paid_on != null && {
      paidOn: inflow.paid_on,
      treatment: engineOneOffTreatment(inflow.one_off_tax_treatment),
      atPreservationAge,
      ...(inflow.years_of_service != null && { yearsOfService: inflow.years_of_service }),
    }),
  }
}

/**
 * Splits `cents` equally across `memberIds`, the last member absorbing the
 * remainder cent so the shares sum back to `cents` exactly. An empty list
 * yields an empty array. Used to attribute pooled household money — projected
 * savings interest here, joint income later — where no member owns it.
 */
export function splitAcrossMembers(cents: number, memberIds: readonly string[]): number[] {
  if (memberIds.length === 0) {
    return []
  }
  const each = Math.floor(cents / memberIds.length)
  return memberIds.map((_, index) =>
    index === memberIds.length - 1 ? cents - each * (memberIds.length - 1) : each,
  )
}

/**
 * Splits `cents` by `percent` (a whole-number 0–100): the first element is
 * `percent`% of `cents` rounded to the nearest cent, the second is the exact
 * remainder, so the two sum back to `cents`. Used to divide a joint inflow's
 * annualised amount between the member it names and the household's other member,
 * the named member carrying the rounding and the other absorbing the residual.
 */
export function splitByPercent(cents: number, percent: number): [number, number] {
  const toMember = Math.round((cents * percent) / 100)
  return [toMember, cents - toMember]
}

/**
 * The engine income inputs one taxable inflow contributes. A non-joint inflow
 * maps to a single {@link toIncomeInput}. A joint inflow — a recurring taxable
 * `other` inflow both partners are assessed on — instead yields two `other`
 * inputs: `member_split_percent`% of its annualised amount to `inflow.member_id`
 * and the remainder to the household's other member (the one of `memberIds` that
 * is not `member_id`), each carrying the inflow's effective window so FY
 * proration still applies. If `memberIds` does not hold exactly two ids, or the
 * inflow's own member is not among them, the whole amount is assessed to
 * `member_id` rather than guessing who the other member is.
 */
export function inflowIncomeInputs(
  inflow: InflowRow,
  memberIds: readonly string[],
  atPreservationAge = false,
): IncomeInput[] {
  const base = toIncomeInput(inflow, atPreservationAge)
  const otherMemberId =
    memberIds.length === 2 ? memberIds.find((id) => id !== inflow.member_id) : undefined
  if (!inflow.is_joint || inflow.member_split_percent == null || otherMemberId == null) {
    return [base]
  }
  const [toMember, toOther] = splitByPercent(annualGrossCents(base), inflow.member_split_percent)
  const half = (memberId: string, amountCents: number): IncomeInput => ({
    memberId,
    type: 'other',
    schedule: 'annual',
    amountCents,
    ...(base.startsOn != null && { startsOn: base.startsOn }),
    ...(base.endsOn != null && { endsOn: base.endsOn }),
  })
  return [half(base.memberId, toMember), half(otherMemberId, toOther)]
}
