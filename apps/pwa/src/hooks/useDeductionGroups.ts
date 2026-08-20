import { financialYearForDate } from '@nest/tax'
import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type DeductionGroupRow = Tables<'deduction_group'>

/**
 * The group fields a form supplies; the household and financial year are set by
 * the hook, exactly as they are for a deduction.
 */
export interface DeductionGroupInput {
  member_id: string
  name: string
}

export interface UseDeductionGroupsResult {
  groups: DeductionGroupRow[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: DeductionGroupInput) => Promise<void>
  update: (id: string, input: DeductionGroupInput) => Promise<void>
  /**
   * Drops the group. Its payments are left standing as ordinary deductions —
   * `deduction.group_id` is cleared by the reference's `on delete set null`, so
   * the deductions collection is refetched alongside.
   */
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's deduction groups for `financialYear`
 * (defaulting to the current financial year), ordered by name. RLS scopes reads
 * to the household.
 *
 * A group names a recurring deductible expense and totals the payments filed
 * under it; it holds no amount of its own, because each payment is a deduction
 * in its own right and the total is their sum.
 */
export function useDeductionGroups(
  householdId: string,
  financialYear: number = financialYearForDate(new Date()),
): UseDeductionGroupsResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'deduction_group',
    DeductionGroupInput
  >(householdId, {
    table: 'deduction_group',
    match: { financial_year: financialYear },
    insertDefaults: { financial_year: financialYear },
    orderBy: 'name',
    // Dropping a group clears its payments' group_id, so the deductions they
    // are read through are stale until refetched.
    alsoInvalidate: ['deduction'],
  })

  return { groups: rows, loading, reload, create, update, remove }
}
