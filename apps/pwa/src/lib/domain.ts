import type {
  BudgetGroup as PlanBudgetGroup,
  EquityInstrumentType as PlanEquityInstrumentType,
  Frequency as PlanFrequency,
  VestingFrequency as PlanVestingFrequency,
} from '@nest/plan'
import type { Enums, Tables } from './database.types'

/**
 * Canonical domain aliases derived from the generated database types (or, where a
 * column is CHECK-constrained `text` rather than a Postgres enum, transcribed from
 * that CHECK), giving the app a single home for the enums and view rows that recur
 * across hooks, forms, and lib helpers rather than each declaring its own copy.
 */

/** How often an amount recurs, from the database `frequency` enum. */
export type Frequency = Enums<'frequency'>

/** The group a budget line belongs to, from the database `budget_group` enum. */
export type BudgetGroup = Enums<'budget_group'>

/**
 * Whether an equity grant is options or shares. `equity_grant.instrument_type` is
 * a CHECK-constrained `text` column, not a Postgres enum, so `gen types` widens it
 * to `string` and this union is transcribed by hand — keep it in lock-step with
 * the CHECK in the `equity_grant` migration.
 */
export type EquityInstrumentType = 'option' | 'share'

/**
 * How often an equity grant's tranches vest after the cliff.
 * `equity_grant.vesting_frequency` is a CHECK-constrained `text` column, not a
 * Postgres enum, so `gen types` widens it to `string` and this union is
 * transcribed by hand — keep it in lock-step with the CHECK in the `equity_grant`
 * migration.
 */
export type VestingFrequency = 'monthly' | 'quarterly' | 'annual'

/** `T` with every property made non-nullable except those named in `K`. */
type NonNullableExcept<T, K extends PropertyKey> = {
  [P in keyof T]: P extends K ? T[P] : NonNullable<T[P]>
}

/**
 * The columns of the account views that are genuinely nullable: a manual account
 * has no `external_id`, a joint account no `owner_member_id`, and an account
 * still present in Up no `deleted_from_source_at`.
 */
type NullableAccountColumn = 'external_id' | 'owner_member_id' | 'deleted_from_source_at'

/**
 * An account's identity joined to its balance, from the `accounts_with_balance`
 * view. The view inner-joins `NOT NULL` columns from `accounts` and
 * `account_balance`, so every column but {@link NullableAccountColumn} is always
 * present; `gen types` widens all view columns to nullable because a view carries
 * no `NOT NULL` metadata, so the row is narrowed back here.
 */
export type Account = NonNullableExcept<Tables<'accounts_with_balance'>, NullableAccountColumn>

/**
 * An account's identity without its balance, from the `account_directory` view —
 * narrowed like {@link Account}, since it selects the same `NOT NULL` columns
 * from `accounts`.
 */
export type AccountDirectoryRow = NonNullableExcept<
  Tables<'account_directory'>,
  NullableAccountColumn
>

/**
 * Compile-time guard that the `@nest/plan` string-literal unions stay in lock-step
 * with the database enums and their hand-transcribed CHECK-column counterparts:
 * each is asserted assignable to the other, so any drift between the shared plan
 * package and the schema fails the build here.
 */
const _assertFrequency: [Frequency, PlanFrequency] = [
  null as unknown as PlanFrequency,
  null as unknown as Frequency,
]
const _assertBudgetGroup: [BudgetGroup, PlanBudgetGroup] = [
  null as unknown as PlanBudgetGroup,
  null as unknown as BudgetGroup,
]
const _assertEquityInstrumentType: [EquityInstrumentType, PlanEquityInstrumentType] = [
  null as unknown as PlanEquityInstrumentType,
  null as unknown as EquityInstrumentType,
]
const _assertVestingFrequency: [VestingFrequency, PlanVestingFrequency] = [
  null as unknown as PlanVestingFrequency,
  null as unknown as VestingFrequency,
]
void _assertFrequency
void _assertBudgetGroup
void _assertEquityInstrumentType
void _assertVestingFrequency
