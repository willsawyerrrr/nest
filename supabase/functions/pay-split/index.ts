/**
 * Serves the household's recommended pay splits to a signed-in native client —
 * the iOS App Intent behind "how does my pay split in Nest". JWT-verified (the
 * default, so no `config.toml` entry): the caller is resolved from their
 * Authorization JWT via `_shared/caller.ts`, then one `members` read gives their
 * household. The routing rows load on a service-role client — the plan is
 * household-wide, past any per-account balance-privacy boundary — and the split
 * is derived by the same `@nest/plan` routing the PWA Splits tab uses.
 *
 * Request: `POST` with a `Bearer` Supabase access token, no body.
 * Response: `{ hasPayAccount, splits: { accountId, name, fortnightlyCents }[],
 *   totalCents, stays: { accountId, name, fortnightlyCents }[],
 *   unassignedFortnightlyCents }`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCaller } from '../_shared/caller.ts'
import { readHouseholdTable } from '../_shared/householdBuffer.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import {
  type AccountRow,
  type AllowanceRow,
  type BudgetLineRow,
  type GoalRow,
  type MemberRow,
  runPaySplit,
} from './run.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  // Captured by resolveHousehold and reused for the row load.
  let admin: SupabaseClient | null = null

  const result = await runPaySplit({
    resolveHousehold: async () => {
      const resolved = await resolveCaller(request)
      if ('error' in resolved) {
        return { error: resolved.error }
      }
      admin = resolved.caller.admin
      const { data, error } = await admin
        .from('members')
        .select('household_id')
        .eq('id', resolved.caller.memberId)
        .maybeSingle()
      if (error) {
        return { error: { status: 500, message: 'Could not resolve household' } }
      }
      if (!data) {
        return { error: { status: 404, message: 'No household membership for this user' } }
      }
      return { householdId: data.household_id as string }
    },
    loadRows: async (householdId) => {
      const [budgetLines, goals, allowances, members, accounts, household] = await Promise.all([
        readHouseholdTable(admin!, householdId, 'budget_line'),
        readHouseholdTable(admin!, householdId, 'savings_goal'),
        readHouseholdTable(admin!, householdId, 'member_allowance'),
        readHouseholdTable(admin!, householdId, 'members'),
        readHouseholdTable(admin!, householdId, 'accounts'),
        admin!.from('households').select('pay_account_id').eq('id', householdId).maybeSingle(),
      ])
      if (household.error) {
        throw new Error(`Failed to read households: ${household.error.message}`)
      }
      return {
        budgetLines: budgetLines as BudgetLineRow[],
        goals: goals as GoalRow[],
        allowances: allowances as AllowanceRow[],
        members: members as MemberRow[],
        accounts: accounts as AccountRow[],
        payAccountId: (household.data?.pay_account_id as string | null | undefined) ?? null,
      }
    },
  })

  return json(result.body, result.status)
})
