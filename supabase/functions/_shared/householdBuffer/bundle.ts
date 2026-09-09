/**
 * Loads every table the server-side buffer ({@link summariseHouseholdFromRows})
 * reads for one household, on a service-role `admin` client — the I/O glue both
 * `notify-eval` and `intent-summary` wire in. The financial-year-scoped tables
 * are filtered to `financialYear`, matching how each PWA hook scopes its own
 * read.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SaverRow } from './adapters.ts'
import type { BudgetSummaryBundle } from './summary.ts'

/** A raw `accounts` row, as much of it as the saver derivation reads. */
export interface AccountRow {
  id: string
  owner_member_id: string | null
  source: string
  type: string
}

/** A raw `account_balance` row. */
export interface BalanceRow {
  account_id: string
  balance_cents: number
}

/**
 * The interest-bearing saver rows the buffer reads: the synced Up savers
 * (`source = 'up'`, `type = 'savings'`, matching the PWA's `useSavers`), each
 * joined to its balance.
 */
export function toSaverRows(
  accounts: readonly AccountRow[],
  balances: readonly BalanceRow[],
): SaverRow[] {
  const balanceByAccount = new Map(
    balances.map((balance) => [balance.account_id, balance.balance_cents]),
  )
  return accounts
    .filter((account) => account.source === 'up' && account.type === 'savings')
    .map((account) => ({
      id: account.id,
      owner_member_id: account.owner_member_id,
      balance_cents: balanceByAccount.get(account.id) ?? 0,
    }))
}

/**
 * Reads every row of `table` for one household on a service-role `admin`
 * client, optionally narrowed to a financial year. The single point that owns
 * the `select('*')` shape both the buffer bundle and `notify-eval` read through.
 */
export async function readHouseholdTable(
  admin: SupabaseClient,
  householdId: string,
  table: string,
  financialYear?: number,
) {
  let query = admin.from(table).select('*').eq('household_id', householdId)
  if (financialYear !== undefined) {
    query = query.eq('financial_year', financialYear)
  }
  const { data, error } = await query
  if (error) {
    throw new Error(`Failed to read ${table}: ${error.message}`)
  }
  // deno-lint-ignore no-explicit-any
  return (data ?? []) as any[]
}

export async function loadBudgetSummaryBundle(
  admin: SupabaseClient,
  householdId: string,
  financialYear: number,
): Promise<BudgetSummaryBundle> {
  const forHousehold = (table: string, fy?: number) =>
    readHouseholdTable(admin, householdId, table, fy)

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
    breakdowns,
    breakdownItems,
    giftBudgets,
    giftRecipients,
    giftDiscretionaryBudgets,
    accounts,
    accountBalances,
  ] = await Promise.all([
    forHousehold('inflows'),
    forHousehold('tax_profile', financialYear),
    forHousehold('super_contribution', financialYear),
    forHousehold('help_debt'),
    forHousehold('deduction', financialYear),
    forHousehold('members'),
    forHousehold('budget_line'),
    forHousehold('temporary_item'),
    forHousehold('savings_goal'),
    forHousehold('breakdown'),
    forHousehold('breakdown_item'),
    forHousehold('gift_budget'),
    forHousehold('gift_recipient'),
    forHousehold('gift_discretionary_budget'),
    forHousehold('accounts'),
    forHousehold('account_balance'),
  ])

  return {
    inflows,
    taxProfiles,
    contributions,
    helpDebts,
    deductions,
    members,
    budgetLines,
    temporaryItems,
    savingsGoals,
    savers: toSaverRows(accounts, accountBalances),
    breakdowns,
    breakdownItems,
    giftBudgets,
    giftRecipients,
    giftDiscretionaryBudget: giftDiscretionaryBudgets[0] ?? null,
  }
}
