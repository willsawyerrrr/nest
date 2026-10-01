/**
 * Read the share and ETF trades off an uploaded broker document — a contract
 * note, trade confirmation, or statement — so the member can confirm them.
 * JWT-verified (the default): the caller is resolved to their own member — and
 * from it their household — from the Authorization JWT, never the body.
 *
 * Takes `{ path, financialYear }`: the object path of a file the client has
 * already uploaded to the private `receipts` bucket, and the financial year the
 * trades are being added to, so a yearless date resolves within that year.
 * Checks that the path's household prefix is the caller's own, downloads it with
 * the service role, and sends it to Claude Haiku 4.5 with a forced tool schema.
 * It returns every trade the model read — units as a number, money as integer
 * cents, converted in TypeScript, never by the model — for the client to turn
 * into reviewable drafts.
 *
 * It writes no trade anywhere: the member confirms and saves. The Anthropic API
 * key is read server-side only, via the service-role-only Vault RPC, and is never
 * returned to the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveCaller } from '../_shared/caller.ts'
import { anthropicExtractor } from './model.ts'
import { DOCUMENTS_BUCKET, type DownloadedObject, runExtract } from './extract.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: { path?: unknown; financialYear?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Captured by the household resolution below and reused for the Vault read and
  // the Storage download, both of which need the service role.
  let admin: SupabaseClient | null = null

  const result = await runExtract(body.path, body.financialYear, {
    resolveHousehold: async () => {
      const resolved = await resolveCaller(request)
      if ('error' in resolved) return { error: resolved.error }
      admin = resolved.caller.admin
      const { data, error } = await resolved.caller.admin
        .from('members')
        .select('household_id')
        .eq('id', resolved.caller.memberId)
        .maybeSingle()
      if (error || !data) {
        return { error: { status: 500, message: 'Could not resolve household' } }
      }
      return { householdId: data.household_id as string }
    },
    // The key never leaves the server: read via the service-role-only Vault RPC.
    apiKey: async () => {
      const { data, error } = await admin!.rpc('anthropic_api_key')
      if (error) return null
      const key = data as unknown
      return typeof key === 'string' && key.trim() ? key.trim() : null
    },
    downloadObject: async (path): Promise<DownloadedObject | null> => {
      const { data, error } = await admin!.storage.from(DOCUMENTS_BUCKET).download(path)
      if (error || !data) return null
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || null }
    },
    extract: (file, apiKey, financialYear) => anthropicExtractor(apiKey)(file, financialYear),
  })

  return json(result.body, result.status)
})
