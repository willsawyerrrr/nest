import type { Enums, Tables } from '../lib/database.types'
import type { Frequency } from '../lib/domain'
import { useHouseholdCollection } from './useCollection'

export type Inflow = Tables<'inflows'>
export type InflowType = Enums<'inflow_type'>

/** The inflow fields a form supplies; identifiers and household are set by the hook. */
export interface InflowInput {
  name: string
  taxable: boolean
  member_id: string | null
  type: InflowType
  /** Whether employer super accrues on the inflow; false for a non-OTE allowance. */
  attracts_super: boolean
  /** The period `amount_cents` covers — the frequency the amount is expressed in. */
  schedule: Frequency
  interval_count: number | null
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
}

export interface UseInflowsResult {
  inflows: Inflow[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: InflowInput) => Promise<void>
  update: (id: string, input: InflowInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Loads and mutates the household's inflows. RLS scopes reads to the household. */
export function useInflows(householdId: string): UseInflowsResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'inflows',
    InflowInput
  >(householdId, { table: 'inflows', orderBy: 'name' })
  return { inflows: rows, loading, reload, create, update, remove }
}
