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
  // `BUDGET_GROUPS` covers every `BudgetGroup` value, so a valid enum always
  // matches and the `?? group` fallback is unreachable.
  /* v8 ignore next */
  return BUDGET_GROUPS.find((entry) => entry.value === group)?.label ?? group
}
