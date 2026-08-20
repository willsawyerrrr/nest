/**
 * Shared, framework-agnostic plan-only budget domain. Imported by the PWA to
 * turn a household's budget lines, inflows, temporary items, and savings goals
 * into the fortnightly/annual reconciliation Summary and goal projections. Pure
 * — no I/O, no database access, no dependency on the tax package (the PWA feeds
 * this package the after-tax income the tax engine produces).
 */

export {
  annualCents,
  fortnightlyCents,
  FORTNIGHTS_PER_YEAR,
  MONTHS_PER_YEAR,
  perPeriodCents,
  PERIODS_PER_YEAR,
  periodsPerYear,
  WEEKS_PER_YEAR,
} from './normalize'

export { isTemporaryActive, summarise } from './summary'
export type { Amounts, BudgetSummary, GroupSummary, SummaryInput } from './summary'

export { projectGoal } from './goal'
export type { GoalProjection } from './goal'

export {
  accruedBalanceCents,
  DEFAULT_ASSUMPTIONS,
  projectSuperBalance,
  toProjectionInput,
  yearsToRetirement,
} from './retirement'
export type { RetirementAssumptions, SuperProjection, SuperProjectionInput } from './retirement'

export { projectNetWorth } from './netWorthProjection'
export type {
  NetWorthGoal,
  NetWorthProjectionInput,
  NetWorthProjectionPoint,
  NetWorthSuperInput,
} from './netWorthProjection'

export {
  equityTotalCents,
  exerciseCostCents,
  grantValueCents,
  grossVestedValueCents,
  vestedQuantity,
} from './equity'
export type { EquityGrant, EquityInstrumentType, VestingFrequency } from './equity'

export {
  assignmentsByAccount,
  isRecommendedSplitAccount,
  paySplitNeedsUpdate,
  resolveDestinationAccountId,
  roundCentsUpToStep,
} from './splits'
export type { AccountAssignments, AssignableLine, RoutableGoal } from './splits'

export { financialYearDayCount, financialYearPeriod, prorateAnnualToPeriod } from './payPeriod'
export type { PayPeriod } from './payPeriod'

export {
  annualInflowGrossCents,
  expectedPeriodGrossCents,
  isOneOff,
  isPeriodOnCadence,
} from './payCadence'
export type {
  ExpectationBasis,
  OneOffInflow,
  PartCycleReason,
  ReconciledInflow,
} from './payCadence'

export {
  latestReportedYearToDate,
  paygWithheldByMember,
  payslipAttributionDate,
  payslipVariance,
  payslipYearToDate,
  payslipYearToDateByMember,
  unmeasuredInflowPositions,
} from './payslip'
export type {
  PayslipActuals,
  PayslipAttribution,
  PayslipEarningLine,
  PayslipExpectation,
  PayslipLine,
  PayslipLineGroupVariance,
  PayslipLineKind,
  PayslipTaxComponent,
  PayslipTaxGroupVariance,
  PayslipTaxLine,
  PayslipTotals,
  PayslipTotalsRow,
  PayslipVariance,
  PayslipYearToDateTotals,
  SuperGuaranteeConfig,
  UnmeasuredInflowPosition,
  UnmeasuredPositionRow,
} from './payslip'

export { payslipYearPositions } from './payslipYearPosition'
export type {
  PayslipPositionRow,
  PayslipYearPosition,
  PayslipYearPositions,
} from './payslipYearPosition'

/** A monetary amount in integer minor units (cents). Never a float. */
export type Money = number

/**
 * How often an amount recurs. Drives periods-per-year for normalization; the
 * fortnight (26 periods/year) is the plan's primary period. `every_n_weeks` and
 * `every_n_months` are arbitrary cadences — an amount received once every N
 * weeks or every N months — each carrying its own interval N rather than a fixed
 * periods-per-year.
 */
export type Frequency =
  | 'weekly'
  | 'fortnightly'
  | 'monthly'
  | 'quarterly'
  | 'biannual'
  | 'annual'
  | 'every_n_weeks'
  | 'every_n_months'

/**
 * The six fixed groups a budget line can belong to. `temporary` is absent: a
 * budget line is never authored as temporary — the Temporary group of the
 * Summary is derived from active temporary items, not from budget lines.
 */
export type BudgetGroup = 'needs' | 'wants' | 'discretionary' | 'savings' | 'investments'

/** A planned recurring allocation to one group, at an amount on a frequency. */
export interface BudgetLine {
  readonly group: BudgetGroup
  readonly amountCents: Money
  readonly frequency: Frequency
  /**
   * The interval N, required only for the `every_n_weeks`/`every_n_months`
   * cadences: allocated once every N weeks or N months, the unit read from
   * `frequency`.
   */
  readonly interval?: number
}

/**
 * Money in that is excluded from assessable income (e.g. a work reimbursement)
 * and adds directly to available cash, at an amount on a frequency.
 */
export interface NonTaxableInflow {
  readonly amountCents: Money
  readonly frequency: Frequency
  /**
   * The interval N, required only for the `every_n_weeks`/`every_n_months`
   * cadences: received once every N weeks or N months, the unit read from
   * `frequency`.
   */
  readonly interval?: number
}

/**
 * A date-driven budget item. `contributionCents` is the fortnightly amount put
 * in — an outflow in the Temporary group — and the item is an active outflow
 * while `now <= targetDate`, dropping out of the live buffer once expired. The
 * app owns no target-amount funding math; an external source of truth owns the
 * balance saved toward the item.
 */
export interface TemporaryItem {
  readonly contributionCents: Money
  /** ISO date (YYYY-MM-DD) the item's active outflow runs through, inclusive. */
  readonly targetDate: string
}

/**
 * A persistent, target-driven savings target. `currentBalanceCents` is entered
 * manually for now. Progress and ETA are projected from the current balance and
 * a fortnightly contribution; the optional `targetDate` yields the contribution
 * required to hit the target by then.
 */
export interface SavingsGoal {
  readonly targetAmountCents: Money
  readonly currentBalanceCents: Money
  /** ISO date (YYYY-MM-DD) the goal is aimed to be met by, if any. */
  readonly targetDate?: string
}
