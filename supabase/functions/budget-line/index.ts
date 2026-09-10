/**
 * Serves one budget line's planned amount to a signed-in native client — the
 * iOS App Intent behind "how much is budgeted for groceries". JWT-verified (the
 * default, so no `config.toml` entry): the caller is resolved from their
 * Authorization JWT via `_shared/caller.ts`, then one `members` read gives their
 * household. The budget lines load on a service-role client — the planned budget
 * is household-wide, past any per-account balance-privacy boundary — the same
 * loader the fortnightly-buffer path uses.
 *
 * Request: `POST` with a `Bearer` Supabase access token and `{ query: string }`.
 * Response: `{ match: { name, amountCents, frequency, intervalCount,
 *   fortnightlyCents, annualCents } | null, names: string[] }`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCaller } from '../_shared/caller.ts'
import { readHouseholdTable } from '../_shared/householdBuffer.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { type BudgetLineRow, runBudgetLine } from './run.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  // A missing or unparseable body leaves the query empty; the response then
  // lists the household's budget line names with no match.
  let query = ''
  try {
    const body = (await request.json()) as { query?: unknown }
    if (typeof body.query === 'string') {
      query = body.query
    }
  } catch {
    // Empty query; handled above.
  }

  // Captured by resolveHousehold and reused for the budget-line load.
  let admin: SupabaseClient | null = null

  const result = await runBudgetLine({
    query,
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
    loadBudgetLines: async (householdId) =>
      (await readHouseholdTable(admin!, householdId, 'budget_line')) as BudgetLineRow[],
  })

  return json(result.body, result.status)
})
