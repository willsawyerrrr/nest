/**
 * Signs a Storage URL for one file a tax agent's shared EOFY view links to — a
 * deduction receipt or a payslip document. `verify_jwt = false` in
 * `supabase/config.toml`, matching `eofy-share`: the caller carries no JWT,
 * only the share token in the request body.
 *
 * `runEofyShareFile` does the whole of the security work (resolve the token,
 * validate the request, check the path is genuinely in scope); this file only
 * wires the database scope queries and the Storage sign call, both against a
 * service-role client, since an anonymous bearer has no `auth.uid()` for
 * Storage's own household-membership policy to match.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveShareGrant, type ShareGrant } from '../_shared/shareGrant.ts'
import {
  runEofyShareFile,
  SHARE_FILE_SIGNED_URL_TTL_SECONDS,
  type ShareFileBucket,
} from './file.ts'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  let body: { token?: unknown; bucket?: unknown; path?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server credentials not configured' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const result = await runEofyShareFile(body.token, body.bucket, body.path, {
    resolveGrant: (token) => resolveShareGrant(admin, token),
    isPathInScope: (bucket, path, grant) => isPathInScope(admin, bucket, path, grant),
    createSignedUrl: (bucket, path) => createSignedUrl(admin, bucket, path),
  })

  return json(result.body, result.status)
})

/**
 * Whether `path` is a legitimate object under `bucket` for `grant`'s household
 * and financial year — the whole of this function's security boundary, since
 * `admin` bypasses Storage RLS to sign it.
 *
 * `receipts`: `path` must be a `deduction_receipt.storage_path` belonging to
 * this household, whose `deduction_id` names a `deduction` row in this
 * household and financial year. `payslips`: `path` must be a `payslip.file_path`
 * in this household and financial year. Two lookups rather than a join keeps
 * each step a plain equality match a service-role client can run directly.
 */
async function isPathInScope(
  admin: SupabaseClient,
  bucket: ShareFileBucket,
  path: string,
  grant: ShareGrant,
): Promise<boolean> {
  if (bucket === 'receipts') {
    const { data: receipt } = await admin
      .from('deduction_receipt')
      .select('deduction_id')
      .eq('household_id', grant.householdId)
      .eq('storage_path', path)
      .maybeSingle()
    if (!receipt) return false

    const { data: deduction } = await admin
      .from('deduction')
      .select('id')
      .eq('id', receipt.deduction_id as string)
      .eq('household_id', grant.householdId)
      .eq('financial_year', grant.financialYear)
      .maybeSingle()
    return deduction !== null
  }

  const { data: payslip } = await admin
    .from('payslip')
    .select('id')
    .eq('household_id', grant.householdId)
    .eq('financial_year', grant.financialYear)
    .eq('file_path', path)
    .maybeSingle()
  return payslip !== null
}

/** Signs `path` in `bucket` for {@link SHARE_FILE_SIGNED_URL_TTL_SECONDS}; null on failure. */
async function createSignedUrl(
  admin: SupabaseClient,
  bucket: ShareFileBucket,
  path: string,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, SHARE_FILE_SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}
