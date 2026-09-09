/**
 * The loose row interfaces the household shaping reads: snake_case, matching the
 * database column names, a structural subset of both the PWA hook row types and
 * of what PostgREST returns. The PWA passes its hook rows straight in; the edge
 * functions pass PostgREST JSON.
 */

/** The `inflows` columns the estimate and the buffer read. */
export interface InflowRow {
  member_id: string | null
  taxable: boolean
  type: string
  schedule: string | null
  amount_cents: number | null
  hourly_rate_cents: number | null
  hours_per_period: number | null
  interval_count: number | null
  starts_on: string | null
  ends_on: string | null
  paid_on: string | null
  attracts_super: boolean
  one_off_tax_treatment: string | null
  years_of_service: number | null
  is_joint: boolean
  member_split_percent: number | null
}

/** The `tax_profile` columns the estimate reads. */
export interface TaxProfileRow {
  member_id: string
  residency: string
  has_private_hospital_cover: boolean
}

/** The `super_profile` columns the contribution-cap summary reads. */
export interface SuperProfileRow {
  member_id: string
  carry_forward_cap_cents: number
}

/** The `help_debt` columns the estimate reads. */
export interface HelpDebtRow {
  member_id: string
  balance_cents: number
}

/** The `deduction` columns the estimate reads. */
export interface DeductionRow {
  member_id: string
  amount_cents: number
}

/** The `super_contribution` columns the estimate and the cap summary read. */
export interface SuperContributionRow {
  member_id: string
  kind: string
  mode: string
  amount_cents: number | null
  percent_bp: number | null
  frequency: string
  interval_count: number | null
}

/** The `members` columns the estimate reads (date of birth prices a termination payment). */
export interface MemberRow {
  id: string
  date_of_birth: string | null
}

/** The `members` column interest attribution reads. */
export interface MemberIdRow {
  id: string
}

/** The `savings_goal` columns projected interest reads. */
export interface InterestGoalRow {
  annual_interest_bps: number | null
  linked_account_id: string | null
  current_balance_cents: number
}

/** A synced Up saver: its balance and (for a joint saver, null) its owner. */
export interface SaverRow {
  id: string
  balance_cents: number
  owner_member_id: string | null
}

/**
 * The `budget_line` columns the buffer reads. A breakdown- or gift-derived
 * line's `amount_cents` (annual) and `frequency` are canonical in the row, so
 * the buffer reads every line the same way and re-derives nothing.
 */
export interface BudgetLineRow {
  line_group: string
  amount_cents: number
  frequency: string
  interval_count: number | null
}

/** A `temporary_item` row: a fortnightly contribution running through a target date. */
export interface TemporaryItemRow {
  contribution_cents: number
  target_date: string
}

/** The rows a household tax estimate is built from. */
export interface TaxEstimateRows {
  inflows: readonly InflowRow[]
  taxProfiles: readonly TaxProfileRow[]
  contributions: readonly SuperContributionRow[]
  helpDebts: readonly HelpDebtRow[]
  deductions: readonly DeductionRow[]
  members: readonly MemberRow[]
}

/**
 * Everything the whole Summary reconciliation reads — the tax-estimate rows plus
 * the plan rows and the interest-bearing savers a goal's projected interest
 * draws on.
 */
export interface BudgetSummaryBundle extends TaxEstimateRows {
  budgetLines: readonly BudgetLineRow[]
  temporaryItems: readonly TemporaryItemRow[]
  /** Savings goals — a goal modelling an interest rate feeds projected interest into the estimate. */
  savingsGoals: readonly InterestGoalRow[]
  /** Synced Up savers (`source = 'up'`, `type = 'savings'`) — resolves a goal's linked-saver balance. */
  savers: readonly SaverRow[]
}
