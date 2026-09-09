/**
 * Serves the household's fortnightly after-saving buffer to a signed-in native
 * client — the iOS App Intent behind "what's my Nest buffer". JWT-verified (the
 * default, so no `config.toml` entry): the caller is resolved from their
 * Authorization JWT via `_shared/caller.ts`, then one `members` read gives their
 * household. The rows load on a service-role client (the buffer reads across the
 * whole household, past any per-account balance-privacy boundary) and the figure
 * is the shared {@link summariseHouseholdFromRows}, exact to the PWA Summary.
 *
 * Request: `POST` with a `Bearer` Supabase access token, no body.
 * Response: `{ fortnightlyAfterSavingCents: number }`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { financialYearForDate } from '@nest/tax'
import { resolveCaller } from '../_shared/caller.ts'
import { loadBudgetSummaryBundle } from '../_shared/householdBuffer.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { runIntentSummary } from './run.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  // Captured by resolveHousehold and reused for the row load.
  let admin: SupabaseClient | null = null

  const result = await runIntentSummary({
    now: () => new Date(),
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
    loadBundle: (householdId) =>
      loadBudgetSummaryBundle(admin!, householdId, financialYearForDate(new Date())),
  })

  return json(result.body, result.status)
})
