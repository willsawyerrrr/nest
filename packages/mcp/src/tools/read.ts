import {
  summariseHouseholdFromRows,
  type BudgetSummaryBundle,
  type SaverRow,
} from '@nest/household'
import { annualCents, fortnightlyCents, type Frequency } from '@nest/plan'
import { financialYearForDate } from '@nest/tax'
import { listMembers, selectAll, type NestContext } from '../context.ts'

interface BudgetLineRecord {
  id: string
  name: string
  line_group: string
  amount_cents: number
  frequency: Frequency
  interval_count: number | null
  management_url: string | null
  is_gift_line: boolean
  breakdown_id: string | null
  goal_id: string | null
  destination_account_id: string | null
}

/**
 * The household's budget lines, optionally narrowed to those whose name contains
 * `name` (case-insensitive), each with its amount normalised to a fortnight and
 * a year.
 */
export async function listBudgetLines(ctx: NestContext, input: { name?: string | undefined }) {
  const rows = await selectAll<BudgetLineRecord>(ctx, 'budget_line')
  const needle = input.name?.trim().toLowerCase()
  const lines = rows
    .filter((row) => needle === undefined || row.name.toLowerCase().includes(needle))
    .sort((a, b) => a.line_group.localeCompare(b.line_group) || a.name.localeCompare(b.name))
    .map((row) => {
      const interval = row.interval_count ?? undefined
      return {
        id: row.id,
        name: row.name,
        group: row.line_group,
        amount_cents: row.amount_cents,
        frequency: row.frequency,
        interval_count: row.interval_count,
        fortnightly_cents: fortnightlyCents(row.amount_cents, row.frequency, interval),
        annual_cents: annualCents(row.amount_cents, row.frequency, interval),
        management_url: row.management_url,
        derived: row.breakdown_id !== null || row.is_gift_line,
        goal_id: row.goal_id,
        destination_account_id: row.destination_account_id,
      }
    })
  return { lines }
}

interface AccountRecord {
  id: string
  source: string
  type: string
  owner_member_id: string | null
  balance_cents: number | null
}

interface GoalRecord {
  id: string
  name: string
  target_amount_cents: number
  current_balance_cents: number
  target_date: string | null
  linked_account_id: string | null
  queue_position: number | null
  annual_interest_bps: number | null
  planned_contribution_cents: number | null
}

/**
 * The household's savings goals with progress. A goal's saved amount is its
 * linked saver's synced balance where that saver is visible to the member, else
 * the balance entered on the goal. A goal with a linked Savings/Investments
 * budget line is active; one with none is queued.
 */
export async function listSavingsGoals(ctx: NestContext) {
  const [goals, accounts, lines] = await Promise.all([
    selectAll<GoalRecord>(ctx, 'savings_goal'),
    selectAll<AccountRecord>(ctx, 'accounts_with_balance'),
    selectAll<BudgetLineRecord>(ctx, 'budget_line'),
  ])
  const balanceByAccount = new Map(accounts.map((a) => [a.id, a.balance_cents ?? 0]))
  const fundedGoalIds = new Set(
    lines.flatMap((line) => (line.goal_id === null ? [] : [line.goal_id])),
  )

  const shaped = goals
    .map((goal) => {
      const saved =
        goal.linked_account_id !== null && balanceByAccount.has(goal.linked_account_id)
          ? balanceByAccount.get(goal.linked_account_id)!
          : goal.current_balance_cents
      return {
        id: goal.id,
        name: goal.name,
        saved_cents: saved,
        target_cents: goal.target_amount_cents,
        remaining_cents: Math.max(goal.target_amount_cents - saved, 0),
        progress_percent:
          goal.target_amount_cents > 0
            ? Math.round((saved / goal.target_amount_cents) * 1000) / 10
            : null,
        target_date: goal.target_date,
        status: fundedGoalIds.has(goal.id) ? ('active' as const) : ('queued' as const),
        queue_position: goal.queue_position,
        annual_interest_bps: goal.annual_interest_bps,
        planned_contribution_cents: goal.planned_contribution_cents,
      }
    })
    .sort((a, b) => {
      if (a.target_date !== null && b.target_date !== null) {
        return a.target_date.localeCompare(b.target_date) || a.name.localeCompare(b.name)
      }
      if (a.target_date !== null) return -1
      if (b.target_date !== null) return 1
      return a.name.localeCompare(b.name)
    })

  return {
    goals: shaped,
    total_saved_cents: shaped.reduce((sum, goal) => sum + goal.saved_cents, 0),
    total_target_cents: shaped.reduce((sum, goal) => sum + goal.target_cents, 0),
  }
}

interface WishlistRecord {
  id: string
  name: string
  amount_cents: number
  member_id: string | null
  note: string | null
}

/** The household's wishlist, each item tagged with the member's name where one is set. */
export async function listWishlist(ctx: NestContext) {
  const [items, members] = await Promise.all([
    selectAll<WishlistRecord>(ctx, 'wishlist_item'),
    listMembers(ctx),
  ])
  const nameById = new Map(members.map((member) => [member.id, member.name]))
  const shaped = items
    .map((item) => ({
      id: item.id,
      name: item.name,
      amount_cents: item.amount_cents,
      member_id: item.member_id,
      member: item.member_id === null ? null : (nameById.get(item.member_id) ?? null),
      note: item.note,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    items: shaped,
    total_cents: shaped.reduce((sum, item) => sum + item.amount_cents, 0),
  }
}

/**
 * The household's fortnightly buffer, computed with the same
 * `summariseHouseholdFromRows` the PWA Summary and the Siri figure use, over
 * rows read under the member's own row-level security. A co-member's saver
 * balances are hidden from the member, so interest projected on a goal linked
 * to one is left out of the estimate.
 */
export async function getFortnightlyBuffer(ctx: NestContext) {
  const now = ctx.now()
  const financialYear = financialYearForDate(now)
  const scoped = { financial_year: financialYear }
  const [
    inflows,
    taxProfiles,
    contributions,
    helpDebts,
    deductions,
    members,
    budgetLines,
    temporaryItems,
    savingsGoals,
    accounts,
  ] = await Promise.all([
    selectAll<BudgetSummaryBundle['inflows'][number]>(ctx, 'inflows'),
    selectAll<BudgetSummaryBundle['taxProfiles'][number]>(ctx, 'tax_profile', scoped),
    selectAll<BudgetSummaryBundle['contributions'][number]>(ctx, 'super_contribution', scoped),
    selectAll<BudgetSummaryBundle['helpDebts'][number]>(ctx, 'help_debt'),
    selectAll<BudgetSummaryBundle['deductions'][number]>(ctx, 'deduction', scoped),
    selectAll<BudgetSummaryBundle['members'][number]>(ctx, 'members'),
    selectAll<BudgetSummaryBundle['budgetLines'][number]>(ctx, 'budget_line'),
    selectAll<BudgetSummaryBundle['temporaryItems'][number]>(ctx, 'temporary_item'),
    selectAll<BudgetSummaryBundle['savingsGoals'][number]>(ctx, 'savings_goal'),
    selectAll<AccountRecord>(ctx, 'accounts_with_balance'),
  ])
  const savers: SaverRow[] = accounts
    .filter((account) => account.source === 'up' && account.type === 'savings')
    .map((account) => ({
      id: account.id,
      owner_member_id: account.owner_member_id,
      balance_cents: account.balance_cents ?? 0,
    }))

  const summary = summariseHouseholdFromRows(
    {
      inflows,
      taxProfiles,
      contributions,
      helpDebts,
      deductions,
      members,
      budgetLines,
      temporaryItems,
      savingsGoals,
      savers,
    },
    now,
  )
  return {
    financial_year: financialYear,
    fortnightly_buffer_cents: summary.afterSaving.fortnightlyCents,
    annual_buffer_cents: summary.afterSaving.annualCents,
    available_fortnightly_cents: summary.available.fortnightlyCents,
    outgoings_fortnightly_cents: summary.outgoings.fortnightlyCents,
    savings_fortnightly_cents: summary.savingsBlock.fortnightlyCents,
    one_off_annual_cents: summary.oneOffCents,
    groups_fortnightly_cents: Object.fromEntries(
      Object.entries(summary.groups).map(([group, amounts]) => [group, amounts.fortnightlyCents]),
    ),
  }
}
