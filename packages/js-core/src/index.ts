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
import { projectGoalQueue, type ActiveGoalFunding, type QueuedGoalFunding } from '@nest/plan'
import { configsByYear, FY2027_CONFIG } from '@nest/tax'
import { summariseBreakdowns } from './breakdowns.ts'
import { projectEstimate, type EstimateInput } from './estimate.ts'
import { serialise } from './serialise.ts'

export type { EstimateInput, EstimateProjection } from './estimate.ts'
export { projectEstimate } from './estimate.ts'
export { serialise } from './serialise.ts'
export { summariseBreakdowns } from './breakdowns.ts'
export type { BreakdownsInput } from './breakdowns.ts'

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
} satisfies Record<string, Entry>
