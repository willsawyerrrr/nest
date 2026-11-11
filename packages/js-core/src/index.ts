/**
 * The engines the native app runs in JavaScriptCore: `@nest/tax`, `@nest/plan`
 * and `@nest/household`, behind three JSON-in, JSON-out entry points. The
 * bundle (`scripts/bundle.js`) exposes them as the `NestEngine` global; Swift's
 * `Engine` calls them with the same rows the PWA and the MCP server feed the
 * same functions, so every surface computes one set of figures.
 */

import {
  estimateHouseholdTaxFromRows,
  netWorthOfRows,
  projectedInterestIncomeInputs,
  summariseHouseholdFromRows,
  type BudgetSummaryBundle,
  type NetWorthRows,
} from '@nest/household'
import {
  assignmentsByAccount,
  budgetOverview,
  isTemporaryActive,
  projectGoalQueue,
  type ActiveGoalFunding,
  type AssignableAllowance,
  type AssignableLine,
  type BudgetLine,
  type MemberAllowance,
  type QueuedGoalFunding,
  type RoutableGoal,
  type TemporaryItem,
} from '@nest/plan'
import { configsByYear, FY2027_CONFIG } from '@nest/tax'
import { summariseBreakdowns } from './breakdowns.ts'
import { deductionFigures, financialYearOptions } from './deductions.ts'
import { summariseEquity } from './equity.ts'
import { projectEstimate, type EstimateInput } from './estimate.ts'
import { previewInflowDraft, summariseInflows } from './inflows.ts'
import { payslipsOverview } from './payslips.ts'
import { serialise } from './serialise.ts'
import { householdYear, mlsWhatIf, salarySacrifice, taxScreen } from './taxScreen.ts'

export type { EstimateInput, EstimateProjection } from './estimate.ts'
export { projectEstimate } from './estimate.ts'
export { serialise } from './serialise.ts'
export { summariseBreakdowns } from './breakdowns.ts'
export { previewInflowDraft, summariseInflows } from './inflows.ts'
export type { InflowDraftInput, InflowDraftPreview, InflowsInput } from './inflows.ts'
export { payslipsOverview } from './payslips.ts'
export type { PayslipsInput } from './payslips.ts'
export type { BreakdownsInput } from './breakdowns.ts'
export { householdYear, mlsWhatIf, salarySacrifice, taxScreen } from './taxScreen.ts'
export type {
  DependentChildrenInput,
  PayslipRow,
  SalarySacrificeInput,
  TaxScreenInput,
} from './taxScreen.ts'
export { deductionFigures, financialYearOptions, workUseAmountCents } from './deductions.ts'
export type { DeductionFiguresInput, FinancialYearOptionsInput } from './deductions.ts'
export { summariseEquity } from './equity.ts'
export type { EquityInput } from './equity.ts'

/** The whole-year tax estimate for a household's rows, projected onto its scalar cents figures. */
export function estimateTax(input: EstimateInput) {
  const members = input.members ?? []
  return projectEstimate(
    estimateHouseholdTaxFromRows(
      input.inflows,
      input.taxProfiles,
      input.contributions ?? [],
      input.helpDebts ?? [],
      input.deductions ?? [],
      configsByYear[input.financialYear] ?? FY2027_CONFIG,
      input.paygWithheld ? new Map(input.paygWithheld) : undefined,
      members,
      projectedInterestIncomeInputs(input.interestGoals ?? [], input.interestSavers ?? [], members),
      input.trades ?? [],
      input.equity,
    ),
  )
}

/** The input of {@link summariseHousehold}: the rows and the instant they are read at. */
export interface SummaryInput {
  bundle: BudgetSummaryBundle
  /** ISO 8601 instant; it picks the financial year and which windowed items are active. */
  now: string
}

/** The household's reconciled Summary (available, outgoings, buffer) at `input.now`. */
export function summariseHousehold(input: SummaryInput) {
  return summariseHouseholdFromRows(input.bundle, new Date(input.now))
}

/** The input of {@link projectGoalQueueAt}. */
export interface GoalQueueInput {
  active: ActiveGoalFunding[]
  queued: QueuedGoalFunding[]
  /** ISO 8601 instant the queue is projected from. */
  now: string
}

/** The savings-goal queue's projected start and completion dates at `input.now`. */
export function projectGoalQueueAt(input: GoalQueueInput) {
  return projectGoalQueue(input.active, input.queued, new Date(input.now))
}

/** The input of {@link budgetOverviewOf}. */
export interface BudgetOverviewInput {
  lines: BudgetLine[]
  allowances: MemberAllowance[]
  temporaryItems: TemporaryItem[]
  /** ISO 8601 instant; it decides which temporary items are still active. */
  now: string
}

/**
 * The Budget screen's figures at `input.now`: each line's amounts, each group's
 * subtotal, each allowance reconciled, and whether each temporary item is active.
 */
export function budgetOverviewOf(input: BudgetOverviewInput) {
  const now = new Date(input.now)
  return {
    ...budgetOverview(input.lines, input.allowances),
    temporaryActive: input.temporaryItems.map((item) => isTemporaryActive(item, now)),
  }
}

/** The input of {@link paySplitRoutes}. */
export interface PaySplitRoutesInput {
  lines: AssignableLine[]
  goals: RoutableGoal[]
  allowances: AssignableAllowance[]
}

/**
 * The pay-split routing the Pay splits screen lists: each account the budget
 * routes money to, in routing order, with its exact fortnightly total and the
 * lines behind it, and the total of lines routed nowhere.
 */
export function paySplitRoutes(input: PaySplitRoutesInput) {
  const { byAccount, linesByAccount, unassignedFortnightlyCents } = assignmentsByAccount(
    input.lines,
    input.goals,
    input.allowances,
  )
  return {
    accounts: Object.entries(byAccount).map(([accountId, fortnightlyCents]) => ({
      accountId,
      fortnightlyCents,
      lines: linesByAccount[accountId] ?? [],
    })),
    unassignedFortnightlyCents,
  }
}

/** The input of {@link netWorthAt}: the rows `netWorthOfRows` reads, with `now` as an ISO 8601 instant. */
export type NetWorthInput = Omit<NetWorthRows, 'now'> & { now: string }

/** The Net worth screen's breakdown and projection at `input.now`. */
export function netWorthAt(input: NetWorthInput) {
  return netWorthOfRows({ ...input, now: new Date(input.now) })
}

/** A bridge entry point: parses its JSON argument, runs an engine, returns JSON. */
type Entry = (inputJson: string) => string

const entry =
  <Input, Output>(run: (input: Input) => Output): Entry =>
  (inputJson) =>
    serialise(run(JSON.parse(inputJson) as Input))

/**
 * The `NestEngine` global the bundle exposes. Every entry takes and returns a
 * JSON string; money is integer cents, and any `bigint` in a result is encoded
 * as a decimal string (see `serialise`).
 */
export const entryPoints = {
  estimateTax: entry(estimateTax),
  summariseHousehold: entry(summariseHousehold),
  projectGoalQueue: entry(projectGoalQueueAt),
  summariseBreakdowns: entry(summariseBreakdowns),
  budgetOverview: entry(budgetOverviewOf),
  taxScreen: entry(taxScreen),
  salarySacrifice: entry(salarySacrifice),
  mlsWhatIf: entry(mlsWhatIf),
  householdYear: entry(householdYear),
  summariseInflows: entry(summariseInflows),
  previewInflowDraft: entry(previewInflowDraft),
  paySplitRoutes: entry(paySplitRoutes),
  payslipsOverview: entry(payslipsOverview),
  deductionFigures: entry(deductionFigures),
  financialYearOptions: entry(financialYearOptions),
  summariseEquity: entry(summariseEquity),
  netWorth: entry(netWorthAt),
} satisfies Record<string, Entry>
