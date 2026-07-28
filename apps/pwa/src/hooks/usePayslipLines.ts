import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type PayslipLineRow = Tables<'payslip_line'>

/**
 * The fields a payslip form supplies for one earnings line; the household and
 * the payslip it hangs off are set when the slip is saved, and whether the line
 * is ordinary time earnings is snapshotted from its inflow by the database.
 */
export interface PayslipLineInput {
  source_inflow_id: string | null
  label: string
  amount_cents: number
}

export interface UsePayslipLinesResult {
  lines: PayslipLineRow[] | null
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Loads the household's payslip lines. RLS scopes reads to the household. Every
 * line the household has is loaded in one pass rather than per payslip, so a
 * screen showing a year of slips resolves each slip's lines from the one cached
 * collection.
 *
 * Read-only: a slip and its lines are one thing the member saves, so they are
 * written together by `usePayslips`'s `save` — in a single transaction, where a
 * failure cannot leave a slip with the wrong lines or none at all.
 */
export function usePayslipLines(householdId: string): UsePayslipLinesResult {
  const { rows, loading, reload } = useHouseholdCollection<'payslip_line', never>(householdId, {
    table: 'payslip_line',
    orderBy: 'created_at',
  })

  return { lines: rows, loading, reload }
}
