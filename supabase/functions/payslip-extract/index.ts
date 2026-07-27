/**
 * Read the figures off an uploaded payslip so the member can confirm them.
 * JWT-verified (the default): the caller is resolved to their own member — and
 * from it their household — from the Authorization JWT, never the body.
 *
 * Takes `{ path }`, the object path of a file the client has already uploaded to
 * the private `payslips` bucket, checks that the path's household prefix is the
 * caller's own, downloads it with the service role, and sends it to Claude Haiku
 * 4.5 with a forced tool schema. It returns the fields the model read — money as
 * integer cents, converted in TypeScript, never by the model — for the manual
 * entry form to pre-fill.
 *
 * It writes no payslip figure anywhere: the member confirms and saves. The
 * Anthropic API key is read server-side only, via the service-role-only Vault
 * RPC, and is never returned to the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveCaller } from '../_shared/caller.ts'
import { anthropicExtractor } from './model.ts'
import { type DownloadedObject, PAYSLIPS_BUCKET, runExtract } from './extract.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: { path?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Captured by the household resolution below and reused for the Vault read and
  // the Storage download, both of which need the service role.
  let admin: SupabaseClient | null = null

  const result = await runExtract(body.path, {
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
      const { data, error } = await admin!.storage.from(PAYSLIPS_BUCKET).download(path)
      if (error || !data) return null
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || null }
    },
    extract: (file, apiKey) => anthropicExtractor(apiKey)(file),
  })

  return json(result.body, result.status)
})
