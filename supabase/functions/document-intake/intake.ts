/**
 * The document-intake flow, with its I/O injected so the ordering and failure
 * behaviour are unit-tested without a network, a database, or Storage.
 * `index.ts` wires the real token resolution, Storage upload, and row insert.
 *
 * This function does one thing only: authenticate the bearer token, validate
 * the posted file, and stage it. It never reads the file's contents, calls the
 * model, or writes a payslip or deduction row — extraction and confirmation
 * happen later, when a member opens the staged item from the Payslips or
 * Deductions tab, through the same `payslip-extract` / `deduction-extract`
 * pipeline a picked file already goes through. Keeping this surface to "accept
 * and stage" is deliberate: it is the one edge function in the document-intake
 * feature that runs unauthenticated (`verify_jwt = false`), so it stays as
 * small as the bearer token pattern requires.
 */

import type { CallerError } from '../_shared/caller.ts'
import type { DocumentIntakeGrant } from '../_shared/documentIntakeToken.ts'

export type DocumentKind = 'payslip' | 'deduction'

export interface FlowResult {
  status: number
  body: unknown
}

/** A file read off the multipart request body. */
export interface UploadedFile {
  bytes: Uint8Array
  /** What the request reported for the part; often absent or generic. */
  contentType: string | null
  /** The filename the part carried; used only to guess a media type and to label the stored object. */
  filename: string
}

export interface NewIntakeRow {
  id: string
  householdId: string
  memberId: string
  kind: DocumentKind
  storagePath: string
  originalFilename: string | null
}

export interface DocumentIntakeDeps {
  /** Resolves the bearer token to its grant, or an error outcome. */
  resolveToken: (token: string) => Promise<{ grant: DocumentIntakeGrant } | { error: CallerError }>
  /** Stores the file's bytes at `path`; false when Storage could not write it. */
  uploadObject: (path: string, file: UploadedFile) => Promise<boolean>
  /** Inserts the staging row; false when it could not be written. */
  insertIntake: (row: NewIntakeRow) => Promise<boolean>
}

/** What the intake accepts: a PDF, or a photo/scan of a document — the same set `payslip-extract`/`deduction-extract` read. */
export const SUPPORTED_MEDIA_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type SupportedMediaType = typeof SUPPORTED_MEDIA_TYPES[number]

/** Extensions to fall back on when the request reports no usable content type. */
const EXTENSION_MEDIA_TYPES: Record<string, SupportedMediaType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Same per-kind caps `payslip-extract`/`deduction-extract` apply at read time — catching an oversized file here yields a clear message immediately, rather than at review. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PDF_BYTES = 20 * 1024 * 1024

function normaliseKind(raw: unknown): DocumentKind | null {
  return raw === 'payslip' || raw === 'deduction' ? raw : null
}

/** Prefers a reported content type that is one of the supported set; falls back to the filename's extension. */
export function resolveMediaType(
  contentType: string | null,
  filename: string,
): SupportedMediaType | null {
  if (contentType && (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(contentType)) {
    return contentType as SupportedMediaType
  }
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_MEDIA_TYPES[extension] ?? null
}

function maxBytesFor(mediaType: SupportedMediaType): number {
  return mediaType === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
}

/**
 * A filename safe to use as a Storage object's final path segment: its own
 * basename (dropping any directory a client might send), with everything but
 * a conservative character set replaced, never empty.
 */
export function sanitiseFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  return cleaned || 'document'
}

/** One decimal place, enough for a size message. */
function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

export async function runDocumentIntake(
  rawToken: unknown,
  rawKind: unknown,
  file: UploadedFile | null,
  deps: DocumentIntakeDeps,
): Promise<FlowResult> {
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''
  const resolved = await deps.resolveToken(token)
  if ('error' in resolved) {
    return { status: resolved.error.status, body: { error: resolved.error.message } }
  }
  const { grant } = resolved

  const kind = normaliseKind(rawKind)
  if (!kind) {
    return { status: 400, body: { error: 'kind must be "payslip" or "deduction".' } }
  }

  if (!file) {
    return { status: 400, body: { error: 'A file is required.' } }
  }
  if (file.bytes.length === 0) {
    return { status: 400, body: { error: 'That file is empty.' } }
  }

  const mediaType = resolveMediaType(file.contentType, file.filename)
  if (!mediaType) {
    return {
      status: 415,
      body: {
        error: `That file type cannot be stored. Send a PDF, JPEG, PNG, or WebP (${
          SUPPORTED_MEDIA_TYPES.join(', ')
        }).`,
      },
    }
  }

  const maxBytes = maxBytesFor(mediaType)
  if (file.bytes.length > maxBytes) {
    return {
      status: 413,
      body: {
        error: `That file is too large (${megabytes(file.bytes.length)} MB; the limit is ${
          megabytes(maxBytes)
        } MB).`,
      },
    }
  }

  const id = crypto.randomUUID()
  const path = `${grant.householdId}/${id}/${sanitiseFilename(file.filename)}`

  const uploaded = await deps.uploadObject(path, file)
  if (!uploaded) {
    return { status: 500, body: { error: 'Could not store this document. Try again.' } }
  }

  const inserted = await deps.insertIntake({
    id,
    householdId: grant.householdId,
    memberId: grant.memberId,
    kind,
    storagePath: path,
    originalFilename: file.filename.trim() || null,
  })
  if (!inserted) {
    return { status: 500, body: { error: 'Could not record this document. Try again.' } }
  }

  return { status: 201, body: { id, kind } }
}
