/**
 * The engines the native app runs in JavaScriptCore: `@nest/tax`, `@nest/plan`
 * and `@nest/household`, behind three JSON-in, JSON-out entry points. The
 * bundle (`scripts/bundle.js`) exposes them as the `NestEngine` global; Swift's
 * `Engine` calls them with the same rows the PWA and the MCP server feed the
 * same functions, so every surface computes one set of figures.
 */

import {
  estimateHouseholdTaxFromRows,
  projectedInterestIncomeInputs,
  summariseHouseholdFromRows,
  type BudgetSummaryBundle,
} from '@nest/household'
import {
  budgetOverview,
  isTemporaryActive,
  projectGoalQueue,
  type ActiveGoalFunding,
  type BudgetLine,
  type MemberAllowance,
  type QueuedGoalFunding,
  type TemporaryItem,
} from '@nest/plan'
import { configsByYear, FY2027_CONFIG } from '@nest/tax'
import { summariseBreakdowns } from './breakdowns.ts'
import { projectEstimate, type EstimateInput } from './estimate.ts'
import { serialise } from './serialise.ts'
import { householdYear, mlsWhatIf, salarySacrifice, taxScreen } from './taxScreen.ts'

export type { EstimateInput, EstimateProjection } from './estimate.ts'
export { projectEstimate } from './estimate.ts'
export { serialise } from './serialise.ts'
export { summariseBreakdowns } from './breakdowns.ts'
export type { BreakdownsInput } from './breakdowns.ts'
export { householdYear, mlsWhatIf, salarySacrifice, taxScreen } from './taxScreen.ts'
export type {
  DependentChildrenInput,
  PayslipRow,
  SalarySacrificeInput,
  TaxScreenInput,
} from './taxScreen.ts'

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
} satisfies Record<string, Entry>
