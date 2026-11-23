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
 * It then lands every Up transaction on those accounts in `transactions`, each
 * account resuming from its latest synced transaction, and rescans the
 * gift category over a trailing window so a transaction recategorised into or
 * out of gifts in the Up app is refreshed (see docs/up-ledger-sync.md). Once
 * per run it also refreshes `up_category` from Up's category taxonomy, and it
 * registers an Up webhook for any connected member without one. The rows it
 * newly inserts prompt their owner, or a joint account's purchaser, to review
 * them (`_shared/transactionReview.ts`).
 */

import { createClient } from '@supabase/supabase-js'
import { UpClient } from '../_shared/up.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveCaller } from '../_shared/caller.ts'
import { promptReviewOfInserted } from '../_shared/notifyClient.ts'
import { registerWithUp } from '../_shared/upWebhook.ts'
import { isServiceRoleToken } from './auth.ts'
import type { TransactionUpsert } from './map.ts'
import { type AccountRow, runSync, type StoredGiftQuery, UP_GIFT_CATEGORY } from './sync.ts'

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
    // The account rows the pass above upserted, read back for their local ids:
    // a transaction names its Up account, and the ledger row it becomes needs
    // the local account, household, and owning member.
    listSyncedAccounts: async (externalIds: string[]) => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, external_id, household_id, owner_member_id, ledger_resync_pending')
        .eq('source', 'up')
        .in('external_id', externalIds)
      if (error) throw new Error(`Failed to resolve synced accounts: ${error.message}`)
      return data ?? []
    },
    clearLedgerResync: async (accountId: string) => {
      const { error } = await supabase
        .from('accounts')
        .update({ ledger_resync_pending: false })
        .eq('id', accountId)
      if (error) throw new Error(`Failed to clear the ledger resync: ${error.message}`)
    },
    latestPostedAt: async (accountId: string) => {
      const { data, error } = await supabase
        .from('transactions')
        .select('posted_at')
        .eq('source', 'up')
        .eq('account_id', accountId)
        .or(`external_category.is.null,external_category.neq.${UP_GIFT_CATEGORY}`)
        .order('posted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(`Failed to read the latest transaction: ${error.message}`)
      return data?.posted_at ?? null
    },
    listAccountTransactions: (token, accountId, since) =>
      new UpClient(token).listAccountTransactions(accountId, since),
    listGiftTransactions: (token, since) =>
      new UpClient(token).listTransactions({ since, category: UP_GIFT_CATEGORY }),
    listStoredGiftTransactionIds: async ({ accountIds, since }: StoredGiftQuery) => {
      if (accountIds.length === 0) return []
      const { data, error } = await supabase
        .from('transactions')
        .select('external_id')
        .eq('source', 'up')
        .eq('external_category', UP_GIFT_CATEGORY)
        .in('account_id', accountIds)
        .gte('posted_at', since)
      if (error) throw new Error(`Failed to list stored gift transactions: ${error.message}`)
      return (data ?? []).map((row) => row.external_id as string)
    },
    getTransaction: (token, id) => new UpClient(token).getTransaction(id),
    // A SECURITY DEFINER RPC: service_role holds no write grant on
    // `transactions`. It upserts on (source, external_id), keeps a linked gift
    // purchase at its transaction's amount, and never writes `notes`.
    syncTransactions: async (householdId: string, rows: TransactionUpsert[]) => {
      const { data, error } = await supabase.rpc('sync_up_transactions', {
        p_household_id: householdId,
        p_rows: rows,
      })
      if (error) throw new Error(`Failed to sync transactions: ${error.message}`)
      return data ?? []
    },
    // A SECURITY DEFINER RPC, for the same reason: deletes the rows Up no
    // longer has, keeping any a gift purchase links.
    deleteTransactions: async (householdId: string, externalIds: string[]) => {
      const { error } = await supabase.rpc('delete_up_transactions', {
        p_household_id: householdId,
        p_external_ids: externalIds,
      })
      if (error) throw new Error(`Failed to delete transactions: ${error.message}`)
    },
    listCategories: (token) => new UpClient(token).listCategories(),
    // A SECURITY DEFINER RPC: service_role holds no write grant on
    // `up_category`. Upserts Up's taxonomy, parents first.
    syncCategories: async (rows) => {
      const { error } = await supabase.rpc('sync_up_categories', { p_rows: rows })
      if (error) throw new Error(`Failed to sync categories: ${error.message}`)
    },
    // A SECURITY DEFINER RPC: clears the member's connection and stamps the
    // failure, called only when their token is rejected with 401/403.
    disconnectMember: async (memberId: string) => {
      const { error } = await supabase.rpc('fail_up_token', { p_member_id: memberId })
      if (error) throw new Error(`Failed to disconnect member: ${error.message}`)
    },
    listMembersWithWebhook: async () => {
      const { data, error } = await supabase.from('up_webhook').select('member_id')
      if (error) throw new Error(`Failed to list webhooks: ${error.message}`)
      return (data ?? []).map((row) => row.member_id as string)
    },
    registerWebhook: async (memberId, token) => {
      const outcome = await registerWithUp(supabase, supabaseUrl, memberId, token)
      if (outcome === 'cap_reached') {
        console.error(`Up webhook cap reached for member ${memberId}; none registered`)
      }
    },
    promptReview: (householdId, insertedIds) =>
      promptReviewOfInserted(supabase, householdId, insertedIds),
  }, householdId)

  return json(result, 200)
})
