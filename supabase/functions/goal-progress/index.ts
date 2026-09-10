/**
 * Serves the household's savings-goal progress to a signed-in native client —
 * the iOS App Intent behind "how are my Nest savings goals going". JWT-verified
 * (the default, so no `config.toml` entry): the caller is resolved from their
 * Authorization JWT via `_shared/caller.ts`, then one `members` read gives their
 * household. The goals load on a service-role client (a goal's progress reads
 * across the whole household, past any per-account balance-privacy boundary), and
 * a linked saver's balance is resolved the same way the PWA Goals screen does.
 *
 * Request: `POST` with a `Bearer` Supabase access token, no body.
 * Response: `{ goals: { name, savedCents, targetCents }[], totalSavedCents, totalTargetCents }`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCaller } from '../_shared/caller.ts'
import {
  type AccountRow,
  type BalanceRow,
  readHouseholdTable,
  toSaverRows,
} from '../_shared/householdBuffer.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { type GoalRow, runGoalProgress } from './run.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  // Captured by resolveHousehold and reused for the goal load.
  let admin: SupabaseClient | null = null

  const result = await runGoalProgress({
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
    loadGoalsAndSavers: async (householdId) => {
      const [goals, accounts, balances] = await Promise.all([
        readHouseholdTable(admin!, householdId, 'savings_goal'),
        readHouseholdTable(admin!, householdId, 'accounts'),
        readHouseholdTable(admin!, householdId, 'account_balance'),
      ])
      return {
        goals: goals as GoalRow[],
        savers: toSaverRows(accounts as AccountRow[], balances as BalanceRow[]),
      }
    },
  })

  return json(result.body, result.status)
})
