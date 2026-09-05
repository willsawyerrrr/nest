/**
 * Accepts a document from outside the PWA — an iOS Shortcut run from the
 * system share sheet — and stages it for a household member to review from
 * the Payslips or Deductions tab. `verify_jwt = false` in
 * `supabase/config.toml`, matching `eofy-share`/`eofy-share-file`: the caller
 * carries no Supabase session, only the document-intake bearer token a member
 * minted from the Household tab and pasted into their Shortcut, sent as
 * `Authorization: Bearer <token>`.
 *
 * The request body is `multipart/form-data` — `kind` (`payslip` or
 * `deduction`) and `file` — because that is what a Shortcut's "Get Contents of
 * URL" action posts. `runDocumentIntake` does the whole of the validation and
 * staging; this file only wires the token resolution, the Storage upload, and
 * the row insert, all against a service-role client since the token holder
 * has no `auth.uid()` for RLS to apply to.
 *
 * The token is resolved before the body is ever read: an invalid or missing
 * one is rejected without parsing the multipart form at all, so an
 * unauthenticated caller cannot force a large file to be buffered into memory
 * just by hitting the endpoint.
 */

import { createClient } from '@supabase/supabase-js'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { resolveDocumentIntakeToken } from '../_shared/documentIntakeToken.ts'
import { type NewIntakeRow, runDocumentIntake, type UploadedFile } from './intake.ts'

const BUCKET = 'document-intake'

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server credentials not configured' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const authHeader = request.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  const tokenResult = await resolveDocumentIntakeToken(admin, token)
  if ('error' in tokenResult) {
    return json({ error: tokenResult.error.message }, tokenResult.error.status)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'Expected a multipart/form-data request.' }, 400)
  }

  const kind = form.get('kind')
  const filePart = form.get('file')
  const file: UploadedFile | null = filePart instanceof File
    ? {
      bytes: new Uint8Array(await filePart.arrayBuffer()),
      contentType: filePart.type || null,
      filename: filePart.name || '',
    }
    : null

  const result = await runDocumentIntake(token, kind, file, {
    // Already resolved above, before the body was read; `runDocumentIntake`
    // still owns checking it first among the request's own contents.
    resolveToken: () => Promise.resolve(tokenResult),
    uploadObject: async (path, uploaded) => {
      const { error } = await admin.storage.from(BUCKET).upload(path, uploaded.bytes, {
        contentType: uploaded.contentType ?? undefined,
      })
      return !error
    },
    insertIntake: async (row: NewIntakeRow) => {
      const { error } = await admin.from('document_intake').insert({
        id: row.id,
        household_id: row.householdId,
        member_id: row.memberId,
        kind: row.kind,
        storage_path: row.storagePath,
        original_filename: row.originalFilename,
      })
      return !error
    },
  })

  return json(result.body, result.status)
})
