import type { BudgetGroup as PlanBudgetGroup, Frequency as PlanFrequency } from '@nest/plan'
import type { Enums } from './database.types'

/**
 * Canonical domain aliases derived from the generated database enums, giving the
 * app a single home for the two enums that recur across hooks, forms, and lib
 * helpers rather than each declaring its own copy.
 */

/** How often an amount recurs, from the database `frequency` enum. */
export type Frequency = Enums<'frequency'>

/** The group a budget line belongs to, from the database `budget_group` enum. */
export type BudgetGroup = Enums<'budget_group'>

/**
 * Compile-time guard that the `@nest/plan` string-literal unions stay in lock-step
 * with the database enums: each is asserted assignable to the other, so any drift
 * between the shared plan package and the schema fails the build here.
 */
const _assertFrequency: [Frequency, PlanFrequency] = [
  null as unknown as PlanFrequency,
  null as unknown as Frequency,
]
const _assertBudgetGroup: [BudgetGroup, PlanBudgetGroup] = [
  null as unknown as PlanBudgetGroup,
  null as unknown as BudgetGroup,
]
void _assertFrequency
void _assertBudgetGroup
