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
  schedule: Frequency
  interval_count: number | null
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
