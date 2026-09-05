import type { Enums, Tables } from '../lib/database.types'
import type { Frequency } from '../lib/domain'
import { useHouseholdCollection } from './useCollection'

export type Inflow = Tables<'inflows'>
export type InflowType = Enums<'inflow_type'>
export type OneOffTaxTreatment = Enums<'one_off_tax_treatment'>

/**
 * The inflow fields a form supplies; identifiers and household are set by the hook.
 *
 * An inflow states either the cadence it recurs on (`schedule`) or the single date
 * it lands on (`paid_on`), never both and never neither — the database's
 * `inflows_recurrence` check. A one-off carries none of the cadence machinery:
 * `interval_count`, `pay_schedule`, `pay_interval_count`, `starts_on`, and `ends_on`
 * are all null on one, and `arrives_every_pay_period` stays true, there being no
 * cadence for it to say anything about.
 */
export interface InflowInput {
  name: string
  taxable: boolean
  member_id: string | null
  type: InflowType
  /** Whether employer super accrues on the inflow; false for a non-OTE allowance. */
  attracts_super: boolean
  /**
   * The period `amount_cents` covers — the frequency the amount is expressed in.
   * Null on a one-off, whose amount is the whole payment.
   */
  schedule: Frequency | null
  /** The single date a one-off's money lands on; null on a recurring inflow. */
  paid_on: string | null
  /**
   * The concession a taxable one-off is assessed under; null on a recurring inflow
   * and on a non-taxable one-off, neither of which is taxed under one.
   */
  one_off_tax_treatment: OneOffTaxTreatment | null
  /**
   * Completed years of service behind a genuine redundancy, which price its tax-free
   * amount; null under every other treatment.
   */
  years_of_service: number | null
  interval_count: number | null
  /**
   * Whether this recurring taxable `other` inflow is income both partners are
   * assessed on (joint interest, jointly-held dividends, a jointly-owned rental).
   * False on every other inflow, none of which can be joint.
   */
  is_joint: boolean
  /**
   * The share of a joint inflow assessed to `member_id`, as a whole-number
   * percentage 0–100; the household's other member is assessed the remainder.
   * Non-null exactly when `is_joint`.
   */
  member_split_percent: number | null
  /**
   * The cadence the money arrives on; null when it arrives on the frequency the
   * amount is expressed in. Sets the pay cycle a payslip period is measured against.
   */
  pay_schedule: Frequency | null
  pay_interval_count: number | null
  /**
   * Whether the money lands on every turn of that cadence. False for pay arriving
   * in only some periods — an on-call allowance paid for the fortnights a shift was
   * worked — which leaves a payslip period no expectation for it. The projection is
   * unaffected either way.
   */
  arrives_every_pay_period: boolean
  amount_cents: number | null
  hourly_rate_cents: number | null
  hours_per_period: number | null
  starts_on: string | null
  ends_on: string | null
  /**
   * One confirmed date this recurring inflow's money actually lands on, which
   * the calendar feed steps its cadence forward and backward from; distinct
   * from `starts_on`, which is the effective-from date and may differ from
   * the first real payday. Null on a one-off, which has no cadence to anchor.
   */
  pay_anchor_date: string | null
}

export interface UseInflowsResult {
  inflows: Inflow[] | null
  /** The inflows before any planning-mode overrides — the real baseline for comparison. */
  baselineInflows: Inflow[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: InflowInput) => Promise<void>
  update: (id: string, input: InflowInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's inflows. RLS scopes reads to the household. */
export function useInflows(householdId: string): UseInflowsResult {
  const { rows, baselineRows, loading, reload, create, update, remove } = useHouseholdCollection<
    'inflows',
    InflowInput
  >(householdId, { table: 'inflows', orderBy: 'name' })
  return { inflows: rows, baselineInflows: baselineRows, loading, reload, create, update, remove }
}
