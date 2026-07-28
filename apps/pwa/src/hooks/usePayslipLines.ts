import { useCallback } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection } from './useCollection'

export type PayslipLineRow = Tables<'payslip_line'>

/**
 * The fields a payslip form supplies for one earnings line; the household and
 * the payslip it hangs off are set when the set is written.
 */
export interface PayslipLineInput {
  source_inflow_id: string | null
  label: string
  amount_cents: number
}

/** The written row: the form's fields plus the payslip and household the hook sets. */
type PayslipLineWrite = PayslipLineInput & { payslip_id: string; household_id: string }

export interface UsePayslipLinesResult {
  lines: PayslipLineRow[] | null
  loading: boolean
  reload: () => Promise<void>
  /**
   * Replaces a payslip's earnings lines with `lines`. A slip's lines are always
   * edited as one set, so they are written as one: the slip's existing lines go
   * and the new set lands in their place, which keeps no identity a form would
   * have to track per row.
   */
  replace: (payslipId: string, lines: readonly PayslipLineInput[]) => Promise<void>
}

/**
 * Loads and rewrites the household's payslip lines. RLS scopes reads to the
 * household. Every line the household has is loaded in one pass rather than per
 * payslip, so a screen showing a year of slips resolves each slip's lines from
 * the one cached collection.
 */
export function usePayslipLines(householdId: string): UsePayslipLinesResult {
  const { rows, loading, reload } = useHouseholdCollection<'payslip_line', PayslipLineWrite>(
    householdId,
    { table: 'payslip_line', orderBy: 'created_at' },
  )

  const replace = useCallback(
    async (payslipId: string, lines: readonly PayslipLineInput[]) => {
      const { error: deleteError } = await supabase
        .from('payslip_line')
        .delete()
        .eq('payslip_id', payslipId)
      if (deleteError) {
        throw deleteError
      }
      if (lines.length > 0) {
        const { error } = await supabase
          .from('payslip_line')
          .insert(
            lines.map((line) => ({ ...line, payslip_id: payslipId, household_id: householdId })),
          )
        if (error) {
          throw error
        }
      }
      await reload()
    },
    [householdId, reload],
  )

  return { lines: rows, loading, reload, replace }
}
