/**
 * Up Bank sync poll. Two callers reach it:
 *
 * - A member's manual refresh from the PWA carries their user Authorization JWT.
 *   The caller is resolved from that JWT (never the body) and the run is scoped
 *   to their household's connected members.
 * - The hourly `pg_cron` schedule invokes it with the service-role key and no
 *   user, syncing every connected member.
 *
 * Either way it pulls all of each member's Up accounts — savers and spending
 * alike — and upserts their balances into the household ledger, deduping on
 * (source, external_id) so a joint account shared across both partners collapses
 * to one row. Individual spending accounts are stored prefixed with the owner's
 * name to disambiguate them. The token is read server-side only, via the
 * service-role-only Vault RPC.
 *
 * Accounts only: transaction ingestion is deferred to a later ledger phase.
 */

import { createClient } from '@supabase/supabase-js'
import { UpClient } from '../_shared/up.ts'
import { handlePreflight, json } from '../_shared/http.ts'
import { resolveCaller } from '../_shared/caller.ts'
import { isServiceRoleToken } from './auth.ts'
import { type AccountRow, runSync } from './sync.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Service-role credentials not configured' }, 500)
  }

  // Determine the run's scope from the caller. The cron path presents a
  // service-role JWT and syncs every household (householdId null); any other
  // caller must resolve to a member via their JWT and is scoped to that
  // member's household. The gateway (verify_jwt=true) has already validated the
  // bearer's signature, so the caller is distinguished by its `role` claim.
  const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  let householdId: string | null = null
  if (!isServiceRoleToken(bearer)) {
    const resolved = await resolveCaller(request)
    if ('error' in resolved) {
      return json({ error: resolved.error.message }, resolved.error.status)
    }
    const { data, error } = await resolved.caller.admin
      .from('members')
      .select('household_id')
      .eq('id', resolved.caller.memberId)
      .maybeSingle()
    if (error || !data) {
      return json({ error: 'Could not resolve household' }, 500)
    }
    householdId = data.household_id as string
  }

  // Service-role client bypasses RLS; used only for trusted server-side sync.
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const result = await runSync({
    listConnectedMembers: async () => {
      const { data, error } = await supabase
        .from('members')
        .select('id, household_id, name')
        .not('up_connected_at', 'is', null)
      if (error) throw new Error(`Failed to list connected members: ${error.message}`)
      return (data ?? []).map((row) => ({
        memberId: row.id,
        householdId: row.household_id,
        name: row.name,
      }))
    },
    // The token never leaves the server: read via the service-role-only Vault RPC.
    tokenFor: async (memberId) => {
      const { data, error } = await supabase.rpc('up_token_for_member', { p_member_id: memberId })
      if (error) throw new Error(`Failed to read token: ${error.message}`)
      return data
    },
    listAccounts: (token) => new UpClient(token).listAccounts(),
    // Balance lives in account_balance, split out of accounts. A single
    // SECURITY DEFINER RPC upserts identity (on source,external_id) and balance
    // (on account_id) atomically, so the two never diverge across a sync.
    upsertAccounts: async (rows: AccountRow[]) => {
      const { error } = await supabase.rpc('upsert_up_accounts', { rows })
      if (error) throw new Error(`Failed to upsert accounts: ${error.message}`)
    },
  }, householdId)

  return json(result)
})
