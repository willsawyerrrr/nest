/**
 * Up Bank sync poll. A backstop to the webhook receiver: on a schedule
 * (pg_cron → this function) or on manual invocation it pulls each member's Up
 * accounts and transactions and upserts them into the household ledger, deduping
 * on (source, external_id). No destructive writes are performed here yet — the
 * DB boundaries are marked as TODOs.
 */

import { createClient } from '@supabase/supabase-js'
import { UpClient } from '../_shared/up.ts'
import { mapAccount, mapTransaction } from './map.ts'

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Service-role credentials not configured', { status: 500 })
  }

  // Service-role client bypasses RLS; used only for trusted server-side sync.
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // TODO: Enumerate members with a linked Up token. For each member, read their
  // personal access token from Supabase Vault (a SECURITY DEFINER RPC over
  // vault.decrypted_secrets, callable only by service_role). Placeholder:
  const memberTokens: { memberId: string; token: string }[] = []
  void supabase

  for (const { memberId, token } of memberTokens) {
    const up = new UpClient(token)

    const accounts = (await up.listAccounts()).map(mapAccount)
    const transactions = (await up.listTransactions()).map(mapTransaction)

    // TODO: Upsert `accounts` into public.accounts on conflict (source,
    // external_id). Then resolve each transaction's account_external_id to the
    // local account_id and upsert `transactions` into public.transactions on
    // conflict (source, external_id), attributing member_id = memberId and
    // stamping household_id. Deletions are handled by the webhook receiver.
    void memberId
    void accounts
    void transactions
  }

  return new Response(JSON.stringify({ synced: memberTokens.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
