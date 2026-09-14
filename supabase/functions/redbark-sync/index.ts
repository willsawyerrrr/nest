/**
 * Redbark bank sync poll. Two callers reach it:
 *
 * - A member's manual refresh from the PWA carries their user Authorization JWT.
 *   The caller is resolved from that JWT (never the body) and the run is
 *   scoped to their household's Redbark connections.
 * - The hourly `pg_cron` schedule invokes it with the service-role key and no
 *   user, syncing every household with a Redbark connection.
 *
 * Reads every account under each connection in scope, filters to
 * `category === 'banking'` (brokerage has no home in the schema and is out of
 * scope), reads each surviving account's balance, and upserts the resulting
 * rows via the `upsert_accounts` RPC — the same one `up-sync` uses. Then
 * reconciles each member's Redbark accounts via `reconcile_source_accounts`.
 * The platform-wide API key is read once per invocation from
 * `REDBARK_API_KEY` (an edge function secret, not Vault — see
 * docs/operations.md); there is no per-member credential to read.
 */

import { createClient } from '@supabase/supabase-js'
import { RedbarkClient } from '../_shared/redbark.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveCaller } from '../_shared/caller.ts'
import { isServiceRoleToken } from '../up-sync/auth.ts'
import { type AccountRow, runSync } from './sync.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Service-role credentials not configured' }, 500)
  }
  const apiKey = Deno.env.get('REDBARK_API_KEY')
  if (!apiKey) {
    return json({ error: 'Redbark is not configured' }, 500)
  }
  const client = new RedbarkClient(apiKey)

  // Determine the run's scope from the caller, exactly as up-sync does: the
  // cron path presents a service-role JWT and syncs every household
  // (householdId null); any other caller must resolve to a member via their
  // JWT and is scoped to that member's household.
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
    listConnections: async () => {
      const { data: connections, error } = await supabase
        .from('redbark_connection')
        .select('id, household_id, member_id')
      if (error) throw new Error(`Failed to list Redbark connections: ${error.message}`)
      if (!connections || connections.length === 0) return []

      // Resolved separately rather than embedded: member_id's FK is composite
      // (member_id, household_id), which PostgREST cannot follow as a
      // single-column embed.
      const memberIds = [...new Set(connections.map((row) => row.member_id as string))]
      const { data: members, error: membersError } = await supabase
        .from('members')
        .select('id, name')
        .in('id', memberIds)
      if (membersError) {
        throw new Error(`Failed to resolve connection owners: ${membersError.message}`)
      }
      const nameById = new Map((members ?? []).map((m) => [m.id as string, m.name as string]))

      return connections.map((row) => ({
        id: row.id as string,
        householdId: row.household_id as string,
        memberId: row.member_id as string,
        memberName: nameById.get(row.member_id as string) ?? '',
      }))
    },
    listAccounts: (connectionId) => client.listAccounts(connectionId),
    getBalance: (accountId) => client.getBalance(accountId),
    // The shared RPC also used by up-sync: identity on (source, external_id),
    // balance on account_id, in one transaction.
    upsertAccounts: async (rows: AccountRow[]) => {
      const { error } = await supabase.rpc('upsert_accounts', { rows })
      if (error) throw new Error(`Failed to upsert accounts: ${error.message}`)
    },
    // The shared per-member reconcile, scoped to this source: service_role has
    // no delete on accounts, so this SECURITY DEFINER RPC is the only path.
    reconcileAccounts: async ({ memberId, householdId, presentExternalIds }) => {
      const { error } = await supabase.rpc('reconcile_source_accounts', {
        p_household_id: householdId,
        p_owner_member_id: memberId,
        p_source: 'redbark',
        p_present_external_ids: presentExternalIds,
      })
      if (error) throw new Error(`Failed to reconcile accounts: ${error.message}`)
    },
  }, householdId)

  return json(result, 200)
})
