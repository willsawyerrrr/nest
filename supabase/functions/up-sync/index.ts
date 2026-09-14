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
 * It then ingests one slice of the ledger: each member's gift-category Up
 * transactions over a trailing window, which the Gifts screen offers as
 * candidate purchases to link against a gift budget. A general transaction
 * ledger — every category, spend reconciliation, actual tax paid — is a separate
 * phase (see docs/up-ledger-sync.md).
 */

import { createClient } from '@supabase/supabase-js'
import { UpClient } from '../_shared/up.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveCaller } from '../_shared/caller.ts'
import { isServiceRoleToken } from './auth.ts'
import { type AccountRow, type GiftTransactionWindow, runSync, UP_GIFT_CATEGORY } from './sync.ts'

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
      const { error } = await supabase.rpc('upsert_accounts', { rows })
      if (error) throw new Error(`Failed to upsert accounts: ${error.message}`)
    },
    // A SECURITY DEFINER RPC: service_role has no delete on `accounts`. It
    // reconciles only this member's individually-owned Up accounts against the
    // ids the token returned — deleting the unreferenced ones Up dropped and
    // flagging the referenced ones. `p_source` is data, not hardcoded, so
    // redbark-sync calls the same RPC for its own reconcile.
    reconcileAccounts: async ({ memberId, householdId, presentExternalIds }) => {
      const { error } = await supabase.rpc('reconcile_source_accounts', {
        p_household_id: householdId,
        p_owner_member_id: memberId,
        p_source: 'up',
        p_present_external_ids: presentExternalIds,
      })
      if (error) throw new Error(`Failed to reconcile accounts: ${error.message}`)
    },
    // The joint twin of the above, keyed on `owner_member_id IS NULL`. Called
    // once per household, and only when every connected member synced with a
    // readable token, against the union of the ids their tokens returned.
    reconcileJointAccounts: async ({ householdId, presentExternalIds }) => {
      const { error } = await supabase.rpc('reconcile_joint_up_accounts', {
        p_household_id: householdId,
        p_present_external_ids: presentExternalIds,
      })
      if (error) throw new Error(`Failed to reconcile joint accounts: ${error.message}`)
    },
    listGiftTransactions: (token, since) =>
      new UpClient(token).listTransactions({ since, category: UP_GIFT_CATEGORY }),
    // The account rows the pass above upserted, read back for their local ids:
    // a transaction names its Up account, and the ledger row it becomes needs
    // the local account, household, and owning member.
    listSyncedAccounts: async (externalIds: string[]) => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, external_id, household_id, owner_member_id')
        .eq('source', 'up')
        .in('external_id', externalIds)
      if (error) throw new Error(`Failed to resolve synced accounts: ${error.message}`)
      return data ?? []
    },
    // A SECURITY DEFINER RPC settles the whole window in one transaction: upsert
    // what Up returned, hold linked purchases to their transaction's amount, and
    // prune the candidates Up no longer reports in the gift category.
    syncGiftTransactions: async (
      { householdId, accountIds, since, rows }: GiftTransactionWindow,
    ) => {
      const { error } = await supabase.rpc('sync_up_gift_transactions', {
        p_household_id: householdId,
        p_account_ids: accountIds,
        p_since: since,
        rows,
      })
      if (error) throw new Error(`Failed to sync gift transactions: ${error.message}`)
    },
  }, householdId)

  return json(result, 200)
})
