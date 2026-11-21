/**
 * Up Bank webhook receiver. Each connected member registers their own webhook
 * at `up-webhook?m=<member_id>`; Up signs each delivery with a hex HMAC-SHA256
 * of the raw body, keyed by that webhook's secret (returned once at
 * registration and held in Vault). The member's secret verifies the
 * `X-Up-Authenticity-Signature` header before any event is acted on, and the
 * member's token then reads the transaction into the ledger (see
 * `handle.ts`). See https://developer.up.com.au/#callback_post_webhookURL.
 */

import { createClient } from '@supabase/supabase-js'
import { UpClient } from '../_shared/up.ts'
import { requirePost } from '../_shared/http.ts'
import { handleDelivery } from './handle.ts'

const SIGNATURE_HEADER = 'X-Up-Authenticity-Signature'

Deno.serve(async (request) => {
  // Server-to-server, so no CORS preflight — only the shared method guard.
  const methodError = requirePost(request)
  if (methodError) return methodError

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Error', { status: 500 })
  }
  // Service-role client: Up's delivery carries no user, and every read and
  // write below is scoped to the member the verified URL names.
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { status, body } = await handleDelivery({
    memberId: new URL(request.url).searchParams.get('m'),
    signature: request.headers.get(SIGNATURE_HEADER),
    rawBody: await request.text(),
  }, {
    secretFor: async (memberId) => {
      const { data, error } = await supabase.rpc('up_webhook_secret_for_member', {
        p_member_id: memberId,
      })
      if (error) throw new Error(`Failed to read the webhook secret: ${error.message}`)
      return data
    },
    householdFor: async (memberId) => {
      const { data, error } = await supabase
        .from('members')
        .select('household_id')
        .eq('id', memberId)
        .maybeSingle()
      if (error) throw new Error(`Failed to read the member: ${error.message}`)
      return data?.household_id ?? null
    },
    tokenFor: async (memberId) => {
      const { data, error } = await supabase.rpc('up_token_for_member', { p_member_id: memberId })
      if (error) throw new Error(`Failed to read token: ${error.message}`)
      return data
    },
    getTransaction: (token, id) => new UpClient(token).getTransaction(id),
    accountFor: async (householdId, upAccountId) => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, external_id, household_id, owner_member_id')
        .eq('source', 'up')
        .eq('household_id', householdId)
        .eq('external_id', upAccountId)
        .maybeSingle()
      if (error) throw new Error(`Failed to resolve the account: ${error.message}`)
      return data
    },
    syncTransactions: async (householdId, rows) => {
      const { data, error } = await supabase.rpc('sync_up_transactions', {
        p_household_id: householdId,
        p_rows: rows,
      })
      if (error) throw new Error(`Failed to sync the transaction: ${error.message}`)
      return data ?? []
    },
    deleteTransactions: async (householdId, externalIds) => {
      const { error } = await supabase.rpc('delete_up_transactions', {
        p_household_id: householdId,
        p_external_ids: externalIds,
      })
      if (error) throw new Error(`Failed to delete the transaction: ${error.message}`)
    },
  })

  return new Response(body, { status })
})
