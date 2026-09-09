/**
 * Shapes a household's raw rows into the `@nest/tax` engine's inputs and runs
 * the estimate. The row shaping works against the loose interfaces in
 * `rows.ts`; the tax MATH — brackets, LITO, the Medicare levy, HELP repayment,
 * Division 293, the one-off concession — stays in `@nest/tax`'s
 * `estimateHouseholdTax`. Each concern lives in its own `tax/` module; this
 * barrel is the package-internal entry the rest of `@nest/household` imports.
 */

export { activeNowTaxableInflows } from './tax/activeNow.ts'
export { availableFinancialYears, currentTaxConfig } from './tax/config.ts'
export { estimateHouseholdTaxFromRows } from './tax/estimate.ts'
export {
  HELP_PAYOFF_MAX_YEARS,
  helpPayoffByMember,
  helpPayoffForBreakdown,
  helpPayoffSummary,
} from './tax/helpPayoff.ts'
export {
  inflowIncomeInputs,
  splitAcrossMembers,
  splitByPercent,
  toIncomeInput,
} from './tax/income.ts'
export { projectedInterestIncomeInputs } from './tax/interestIncome.ts'
export { atPreservationAgeOn, ENGINE_ONE_OFF_TREATMENTS } from './tax/oneOff.ts'
export type { StoredOneOffTaxTreatment } from './tax/oneOff.ts'
export {
  assessableByMemberFromInflows,
  concessionalByMember,
  deductionsByMember,
  grossByMemberFromInflows,
  helpDebtCentsByMember,
  netAnnualSuperContributionByMember,
  netAnnualSuperContributionFromRows,
  nonConcessionalByMember,
  superCapSummaryByMember,
  superCapSummaryFromRows,
} from './tax/superBases.ts'
export type { SuperCapSummary } from './tax/superBases.ts'
