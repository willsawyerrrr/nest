/**
 * Serves a tax agent's shared EOFY view: the same raw rows `EofySection.tsx`
 * loads for the household's own EOFY tab, sourced from a validated share
 * token instead of a Supabase session. `verify_jwt = false` in
 * `supabase/config.toml` — the caller carries no JWT at all, so the token in
 * the request body is the whole of the credential, resolved against
 * `share_grant` by `_shared/shareGrant.ts`.
 *
 * Every table read runs on a service-role client (there is no `auth.uid()` for
 * the household's own RLS policies to match), scoped by hand to the resolved
 * grant's household — and, for the financial-year-scoped tables, its financial
 * year — exactly as the corresponding household hook scopes its own read.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveShareGrant, type ShareGrant } from '../_shared/shareGrant.ts'
import { type EofyShareRows, type Row, runEofyShare } from './data.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: { token?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server credentials not configured' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const result = await runEofyShare(body.token, {
    resolveGrant: (token) => resolveShareGrant(admin, token),
    loadRows: (grant) => loadEofyShareRows(admin, grant),
  })

  return json(result.body, result.status)
})

/** Runs one `select` scoped to `householdId`, throwing on a database error. */
async function selectForHousehold(
  admin: SupabaseClient,
  table: string,
  householdId: string,
  financialYear?: number,
): Promise<Row[]> {
  let query = admin.from(table).select('*').eq('household_id', householdId)
  if (financialYear !== undefined) {
    query = query.eq('financial_year', financialYear)
  }
  const { data, error } = await query
  if (error) {
    throw new Error(`Failed to read ${table}: ${error.message}`)
  }
  return (data ?? []) as Row[]
}

/**
 * Loads every row the shared view needs, scoped to the resolved grant:
 * unfiltered by financial year for `members`, `inflows`, and `helpDebts`
 * (mirroring `useInflows`/`useHelpDebts`, which read the household's whole
 * history), scoped to the grant's financial year for the rest, and
 * `deductionReceipts` pre-filtered to the deductions already loaded — never
 * a year outside the share.
 */
async function loadEofyShareRows(
  admin: SupabaseClient,
  { householdId, financialYear }: ShareGrant,
): Promise<EofyShareRows> {
  // date_of_birth travels too (never email or user_id): estimateHouseholdTaxFromRows
  // reads it to price a one-off termination payment's tax-free amount against the
  // member's age at preservation, so leaving it out would silently mis-tax a
  // genuine redundancy for the shared view alone. It is not rendered anywhere —
  // a tax agent needs it for real filing regardless.
  const { data: membersData, error: membersError } = await admin
    .from('members')
    .select('id, name, date_of_birth')
    .eq('household_id', householdId)
    .order('name')
  if (membersError) {
    throw new Error(`Failed to read members: ${membersError.message}`)
  }

  const [
    inflows,
    taxProfiles,
    superContributions,
    superProfiles,
    helpDebts,
    deductions,
    payslips,
    savingsGoals,
    accounts,
  ] = await Promise.all([
    selectForHousehold(admin, 'inflows', householdId),
    selectForHousehold(admin, 'tax_profile', householdId, financialYear),
    selectForHousehold(admin, 'super_contribution', householdId, financialYear),
    selectForHousehold(admin, 'super_profile', householdId, financialYear),
    selectForHousehold(admin, 'help_debt', householdId),
    selectForHousehold(admin, 'deduction', householdId, financialYear),
    selectForHousehold(admin, 'payslip', householdId, financialYear),
    // Unfiltered by financial year, matching `useGoals`; feeds projected savings
    // interest into the shared tax estimate.
    selectForHousehold(admin, 'savings_goal', householdId),
    loadAccountsWithBalance(admin, householdId),
  ])

  const deductionIds = deductions.map((deduction) => deduction.id as string)
  let deductionReceipts: Row[] = []
  if (deductionIds.length > 0) {
    const { data, error } = await admin
      .from('deduction_receipt')
      .select('*')
      .eq('household_id', householdId)
      .in('deduction_id', deductionIds)
    if (error) {
      throw new Error(`Failed to read deduction_receipt: ${error.message}`)
    }
    deductionReceipts = (data ?? []) as Row[]
  }

  return {
    members: (membersData ?? []) as Row[],
    inflows,
    taxProfiles,
    superContributions,
    superProfiles,
    helpDebts,
    deductions,
    deductionReceipts,
    payslips,
    savingsGoals,
    accounts,
  }
}

/**
 * Each household account's identity joined to its balance, as
 * `accounts_with_balance` gives an authenticated caller — rebuilt here from the
 * `accounts` and `account_balance` tables because that view is granted to
 * `authenticated` alone, not the service role. Only `{ id, owner_member_id,
 * balance_cents }` is kept: enough to resolve a goal's linked saver balance and
 * its ownership for projected-interest attribution, and no balance is rendered.
 */
async function loadAccountsWithBalance(
  admin: SupabaseClient,
  householdId: string,
): Promise<Row[]> {
  const [accounts, balances] = await Promise.all([
    selectForHousehold(admin, 'accounts', householdId),
    selectForHousehold(admin, 'account_balance', householdId),
  ])
  const balanceByAccount = new Map(
    balances.map((balance) => [balance.account_id as string, balance.balance_cents as number]),
  )
  return accounts.map((account) => ({
    id: account.id,
    owner_member_id: account.owner_member_id,
    balance_cents: balanceByAccount.get(account.id as string) ?? 0,
  }))
}
