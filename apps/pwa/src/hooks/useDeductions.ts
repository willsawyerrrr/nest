import { financialYearForDate } from '@nest/tax'
import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

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

export interface UseDeductionsResult {
  deductions: DeductionRow[] | null
  financialYear: number
  loading: boolean
  reload: () => Promise<void>
  create: (input: DeductionInput) => Promise<void>
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
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'deduction',
    DeductionInput
  >(householdId, {
    table: 'deduction',
    match: { financial_year: financialYear },
    insertDefaults: { financial_year: financialYear },
    orderBy: 'deduction_date',
  })
  return { deductions: rows, financialYear, loading, reload, create, update, remove }
}
