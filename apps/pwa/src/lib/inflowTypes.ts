import type { InflowType, OneOffTaxTreatment } from '../hooks/useInflows'

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

/**
 * Type options for a taxable ONE-OFF, in display order: the taxable types less
 * `wage`. A wage prices hours at a rate over a period, and a payment that lands once
 * has neither, which the database's own one-off shape check holds it to.
 */
export const TAXABLE_ONE_OFF_TYPE_OPTIONS = optionsFor(['salary', 'other'])

/**
 * The human label for every tax treatment a taxable one-off can carry. Each names
 * the concession the FY estimate models for the payment rather than the payment
 * itself, since that is what the choice decides.
 */
const ONE_OFF_TAX_TREATMENT_LABELS: Record<OneOffTaxTreatment, string> = {
  ordinary: 'Ordinary income',
  genuine_redundancy: 'Genuine redundancy',
  employment_termination: 'Employment termination payment',
  unused_leave: 'Unused leave on redundancy',
}

/** The human label for a one-off's tax treatment. */
export function oneOffTaxTreatmentLabel(treatment: OneOffTaxTreatment): string {
  return ONE_OFF_TAX_TREATMENT_LABELS[treatment]
}

/** Tax-treatment options for a taxable one-off, in display order. */
export const ONE_OFF_TAX_TREATMENT_OPTIONS: { value: OneOffTaxTreatment; label: string }[] = (
  ['ordinary', 'genuine_redundancy', 'employment_termination', 'unused_leave'] as const
).map((value) => ({ value, label: ONE_OFF_TAX_TREATMENT_LABELS[value] }))
