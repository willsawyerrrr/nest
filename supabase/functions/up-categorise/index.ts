/**
 * Recategorise an Up transaction. JWT-verified: the caller is resolved from the
 * Authorization JWT (never the body).
 *
 * Takes `{ transaction_id, category_id }` (a Nest transaction id; an Up child
 * category id, or null to clear it), or `{ transaction_ids, category_id }` to
 * recategorise up to 100 transactions at once, answering each one's outcome. The transaction is read through the
 * caller's own RLS-scoped client, so a row they cannot see is not found. The
 * category is written to Up with the caller's own token, read server-side via
 * the service-role-only Vault RPC, then recorded on the local row through the
 * service-role-only `set_up_transaction_category` RPC so the Gifts inbox
 * reflects it straight away. Failures are a stable `code` with fixed copy.
 */

import { MAX_RATE_LIMIT_RETRIES, UpClient } from '../_shared/up.ts'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveCaller, type ResolvedCaller } from '../_shared/caller.ts'
import { runCategorise } from './categorise.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ code: 'invalid_request', error: 'Invalid JSON body' }, 400)
  }

  let caller: ResolvedCaller | null = null
  const result = await runCategorise(body, {
    resolveMember: async () => {
      const resolved = await resolveCaller(request)
      if ('error' in resolved) return { error: resolved.error }
      caller = resolved.caller
      return { memberId: caller.memberId }
    },
    readTransaction: async (id) => {
      const { data, error } = await caller!.asUser
        .from('transactions')
        .select('id, source, external_id, is_categorizable')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(`Failed to read the transaction: ${error.message}`)
      return data
    },
    readCategory: async (id) => {
      const { data, error } = await caller!.asUser
        .from('up_category')
        .select('id, parent_id')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(`Failed to read the category: ${error.message}`)
      return data
    },
    // The token never leaves the server: read via the service-role-only Vault RPC.
    tokenFor: async (memberId) => {
      const { data, error } = await caller!.admin.rpc('up_token_for_member', {
        p_member_id: memberId,
      })
      if (error) throw new Error(`Failed to read token: ${error.message}`)
      return data
    },
    categorise: (token, upId, categoryId, retryRateLimit) =>
      new UpClient(token).categoriseTransaction(
        upId,
        categoryId,
        retryRateLimit ? MAX_RATE_LIMIT_RETRIES : 0,
      ),
    recordCategory: async (transactionId, categoryId) => {
      const { data, error } = await caller!.admin.rpc('set_up_transaction_category', {
        p_transaction_id: transactionId,
        p_category: categoryId,
      })
      if (error) console.error('Recording the category failed:', error)
      return !error && data === true
    },
  })

  return json(result.body, result.status)
})
