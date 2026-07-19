/**
 * Up Bank sync poll. On a schedule (pg_cron → this function) or on manual
 * invocation it pulls each connected member's Up accounts and upserts their
 * balances into the household ledger, deduping on (source, external_id).
 *
 * Accounts only: transaction ingestion is deferred to a later ledger phase.
 */

import { createClient } from '@supabase/supabase-js'
import { UpClient } from '../_shared/up.ts'
import { type AccountRow, runSync } from './sync.ts'

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Service-role credentials not configured', { status: 500 })
  }

  // Service-role client bypasses RLS; used only for trusted server-side sync.
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const result = await runSync({
    listConnectedMembers: async () => {
      const { data, error } = await supabase
        .from('members')
        .select('id, household_id')
        .not('up_connected_at', 'is', null)
      if (error) throw new Error(`Failed to list connected members: ${error.message}`)
      return (data ?? []).map((row) => ({ memberId: row.id, householdId: row.household_id }))
    },
    // The token never leaves the server: read via the service-role-only Vault RPC.
    tokenFor: async (memberId) => {
      const { data, error } = await supabase.rpc('up_token_for_member', { p_member_id: memberId })
      if (error) throw new Error(`Failed to read token: ${error.message}`)
      return data
    },
    listAccounts: (token) => new UpClient(token).listAccounts(),
    upsertAccounts: async (rows: AccountRow[]) => {
      const { error } = await supabase
        .from('accounts')
        .upsert(rows, { onConflict: 'source,external_id' })
      if (error) throw new Error(`Failed to upsert accounts: ${error.message}`)
    },
  })

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
})
