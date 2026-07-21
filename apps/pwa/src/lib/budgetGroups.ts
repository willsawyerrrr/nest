import type { BudgetGroup } from './domain'

/** The five budget groups in display order, each with its human label. */
export const BUDGET_GROUPS: { value: BudgetGroup; label: string }[] = [
  { value: 'needs', label: 'Needs' },
  { value: 'wants', label: 'Wants' },
  { value: 'discretionary', label: 'Discretionary' },
  { value: 'savings', label: 'Savings' },
  { value: 'investments', label: 'Investments' },
]

/** The human label for a budget group. */
export function groupLabel(group: BudgetGroup): string {
  return BUDGET_GROUPS.find((entry) => entry.value === group)?.label ?? group
}
