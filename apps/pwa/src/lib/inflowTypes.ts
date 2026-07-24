import type { InflowType } from '../hooks/useInflows'

/**
 * The human label for every inflow type. `other` is offered under both
 * taxabilities; every other type belongs to a single one.
 */
const INFLOW_TYPE_LABELS: Record<InflowType, string> = {
  salary: 'Salary',
  wage: 'Wage',
  other: 'Other',
  reimbursement: 'Reimbursement',
  hobby: 'Hobby income',
  gift: 'Gift',
}

/** The human label for an inflow type. */
export function inflowTypeLabel(type: InflowType): string {
  return INFLOW_TYPE_LABELS[type]
}

const optionsFor = (types: readonly InflowType[]): { value: InflowType; label: string }[] =>
  types.map((value) => ({ value, label: INFLOW_TYPE_LABELS[value] }))

/** Type options for a taxable inflow, in display order. */
export const TAXABLE_INFLOW_TYPE_OPTIONS = optionsFor(['salary', 'wage', 'other'])

/** Type options for a non-taxable inflow, in display order. */
export const NON_TAXABLE_INFLOW_TYPE_OPTIONS = optionsFor([
  'reimbursement',
  'hobby',
  'gift',
  'other',
])
