import { useCallback } from 'react'
import { financialYearForDate } from '@nest/tax'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection } from './useCollection'
import type { PendingReceipt } from './useDeductionReceipts'

export type DeductionRow = Tables<'deduction'>

/**
 * The deduction fields a form supplies for a member; the household and financial
 * year are set by the hook. A member may claim many deductions, so deductions are
 * created, updated, and removed individually.
 */
export interface DeductionInput {
  member_id: string
  description: string
  amount_cents: number
  deduction_date: string
}

/**
 * What the add-deduction form saves: the id it mints for the deduction (and
 * for every receipt already uploaded under it), the deduction's own fields, and
 * the receipts already uploaded to Storage for it. The two are written together
 * by `create_deduction_with_receipts`, so a partial failure can leave neither a
 * deduction with receipts silently missing nor a receipt with no deduction to
 * hang off.
 */
export interface DeductionSubmission {
  id: string
  input: DeductionInput
  receipts: readonly PendingReceipt[]
}

export interface UseDeductionsResult {
  deductions: DeductionRow[] | null
  financialYear: number
  loading: boolean
  reload: () => Promise<void>
  /**
   * Writes a new deduction and its already-uploaded receipts together, under
   * the id the add form minted, in one transaction — see
   * `create_deduction_with_receipts`.
   */
  create: (submission: DeductionSubmission) => Promise<void>
  update: (id: string, input: DeductionInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's tax deductions for `financialYear`
 * (defaulting to the current financial year), ordered by date. RLS scopes reads
 * to the household.
 */
export function useDeductions(
  householdId: string,
  financialYear: number = financialYearForDate(new Date()),
): UseDeductionsResult {
  const { rows, loading, reload, update, remove } = useHouseholdCollection<
    'deduction',
    DeductionInput
  >(householdId, {
    table: 'deduction',
    match: { financial_year: financialYear },
    insertDefaults: { financial_year: financialYear },
    orderBy: 'deduction_date',
    // create_deduction_with_receipts writes a deduction's deduction_receipt
    // rows alongside it, so the receipts collection is refetched too.
    alsoInvalidate: ['deduction_receipt'],
  })

  const create = useCallback(
    async ({ id, input, receipts }: DeductionSubmission) => {
      const { error } = await supabase.rpc('create_deduction_with_receipts', {
        p_deduction: { ...input, id, household_id: householdId, financial_year: financialYear },
        p_receipts: receipts.map((receipt) => ({ ...receipt })),
      })
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, financialYear, reload],
  )

  return { deductions: rows, financialYear, loading, reload, create, update, remove }
}
