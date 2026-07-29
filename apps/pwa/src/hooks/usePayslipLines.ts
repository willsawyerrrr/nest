import type { Enums, Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type PayslipLineRow = Tables<'payslip_line'>

/** What a line is: an earning drawing on an inflow, or tax paying a component. */
export type PayslipLineKind = Enums<'payslip_line_kind'>

/** Which part of the estimated liability a tax line pays. */
export type PayslipTaxComponent = Enums<'payslip_tax_component'>

/**
 * The fields a payslip form supplies for one line; the household and the payslip
 * it hangs off are set when the slip is saved, and whether an earnings line is
 * ordinary time earnings is snapshotted from its inflow by the database.
 *
 * The pair of references is exclusive, as the database's own check constraint
 * requires: an earnings line names the inflow it draws on and no component, and a
 * tax line names the component it pays and no inflow.
 */
export interface PayslipLineInput {
  kind: PayslipLineKind
  source_inflow_id: string | null
  tax_component: PayslipTaxComponent | null
  label: string
  amount_cents: number
}

export interface UsePayslipLinesResult {
  lines: PayslipLineRow[] | null
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Loads the household's payslip lines, earnings and tax alike. RLS scopes reads
 * to the household. Every line the household has is loaded in one pass rather
 * than per payslip, so a screen showing a year of slips resolves each slip's lines
 * from the one cached collection.
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
