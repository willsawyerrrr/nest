import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionRow } from '../hooks/useDeductions'

export interface GroupedDeductions {
  /** Each group in the order given, with the payments filed under it and their sum. */
  groups: { group: DeductionGroupRow; payments: DeductionRow[]; totalCents: number }[]
  ungrouped: DeductionRow[]
}

/**
 * Splits one member's deductions by the member's groups, as the Deductions tab
 * lists them. A group's total is summed from its payments, never stored, so a
 * group with no payments totals zero.
 */
export function groupDeductions(
  groups: readonly DeductionGroupRow[],
  deductions: readonly DeductionRow[],
): GroupedDeductions {
  return {
    groups: groups.map((group) => {
      const payments = deductions.filter((deduction) => deduction.group_id === group.id)
      return {
        group,
        payments,
        totalCents: payments.reduce((total, payment) => total + payment.amount_cents, 0),
      }
    }),
    ungrouped: deductions.filter((deduction) => deduction.group_id === null),
  }
}
