/**
 * Serves a household's money dates as a subscribable iCalendar feed. A calendar
 * client polling the URL carries no Supabase session, so `verify_jwt = false` in
 * `supabase/config.toml` (matching `up-webhook` / `eofy-share`) and the token in
 * the request — a trailing path segment or `?token=` — is the whole of the
 * credential, resolved against `calendar_feed` by `_shared/calendarFeed.ts`.
 *
 * Every table read runs on a service-role client (there is no `auth.uid()` for
 * the household's own RLS policies to match), scoped by hand to the resolved
 * feed's household. `runCalendarIcs` owns the flow and `events.ts` the ICS
 * rendering; this file only wires the token extraction and the reads.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveCalendarFeed } from '../_shared/calendarFeed.ts'
import type { CalendarDatedRow, CalendarInflowRow, CalendarRows } from './events.ts'
import { runCalendarIcs, tokenFromRequest } from './feed.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server credentials not configured' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const result = await runCalendarIcs(tokenFromRequest(new URL(request.url)), new Date(), {
    resolveFeed: (token) => resolveCalendarFeed(admin, token),
    loadRows: (householdId) => loadCalendarRows(admin, householdId),
  })

  return new Response(request.method === 'HEAD' ? null : result.body, {
    status: result.status,
    headers: { ...corsHeaders, 'Content-Type': result.contentType },
  })
})

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Runs one household-scoped `select`, throwing on a database error. */
async function selectForHousehold<T>(
  admin: SupabaseClient,
  table: string,
  columns: string,
  householdId: string,
): Promise<T[]> {
  const { data, error } = await admin.from(table).select(columns).eq('household_id', householdId)
  if (error) {
    throw new Error(`Failed to read ${table}: ${error.message}`)
  }
  return (data ?? []) as T[]
}

/** Loads every dated row the feed needs, scoped to the resolved feed's household. */
async function loadCalendarRows(
  admin: SupabaseClient,
  householdId: string,
): Promise<CalendarRows> {
  const { data: household, error: householdError } = await admin
    .from('households')
    .select('name')
    .eq('id', householdId)
    .maybeSingle()
  if (householdError) {
    throw new Error(`Failed to read households: ${householdError.message}`)
  }

  const [inflows, savingsGoals, temporaryItems] = await Promise.all([
    selectForHousehold<CalendarInflowRow>(
      admin,
      'inflows',
      'id, name, schedule, paid_on, interval_count, pay_schedule, pay_interval_count, starts_on, ends_on, pay_anchor_date',
      householdId,
    ),
    selectForHousehold<CalendarDatedRow>(
      admin,
      'savings_goal',
      'id, name, target_date',
      householdId,
    ),
    selectForHousehold<CalendarDatedRow>(
      admin,
      'temporary_item',
      'id, name, target_date',
      householdId,
    ),
  ])

  const name = (household as { name: string } | null)?.name?.trim()
  return {
    householdName: name && name !== '' ? name : 'Your household',
    inflows,
    savingsGoals,
    temporaryItems,
  }
}
