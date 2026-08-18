import { useCallback } from 'react'
import type { Tables } from '../lib/database.types'
import {
  EXTRACTION_FAILED_MESSAGE,
  readExtraction,
  readExtractionFailure,
  type ExtractionOutcome,
} from '../lib/deductionExtraction'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection } from './useCollection'

export type DeductionReceiptRow = Tables<'deduction_receipt'>

/** The `deduction_receipt` fields an upload supplies; the household is set by the hook. */
interface DeductionReceiptInput {
  deduction_id: string
  storage_path: string
  file_name: string
}

/**
 * A receipt already uploaded to Storage but not yet backed by a
 * `deduction_receipt` row — the shape `create_deduction_with_receipts` takes,
 * for a deduction still being added.
 */
export interface PendingReceipt {
  storage_path: string
  file_name: string
}

/** The one field a rename may change; the stored file and its path are untouched. */
interface DeductionReceiptRenameInput {
  file_name: string
}

/** The private Storage bucket receipt files live in. */
const RECEIPTS_BUCKET = 'receipts'

export interface UseDeductionReceiptsResult {
  receipts: DeductionReceiptRow[] | null
  loading: boolean
  reload: () => Promise<void>
  /** Uploads `file` for a deduction and records a receipt row pointing at it. */
  upload: (deductionId: string, file: File) => Promise<void>
  /** Removes a receipt's stored file and its row. */
  remove: (receipt: DeductionReceiptRow) => Promise<void>
  /**
   * Renames a receipt's display label. Purely a label: `storage_path` and the
   * underlying stored file are untouched.
   */
  rename: (receipt: DeductionReceiptRow, fileName: string) => Promise<void>
  /** A short-lived signed URL for viewing a stored receipt, or null on failure. */
  signedUrl: (path: string) => Promise<string | null>
  /**
   * Uploads `file` under `deductionId` in Storage without a `deduction_receipt`
   * row — for a deduction not yet created, whose receipts are written together
   * with it by `create_deduction_with_receipts`.
   */
  uploadPending: (deductionId: string, file: File) => Promise<PendingReceipt>
  /**
   * Deletes an uploaded object no deduction references — one the member
   * removed, or walked away from before saving the deduction. Best effort: a
   * failure is swallowed, not surfaced to the form.
   */
  discardPending: (path: string) => Promise<void>
  /** Reads an uploaded receipt through `deduction-extract` so the add form can pre-fill. */
  extract: (path: string) => Promise<ExtractionOutcome>
}

/** How long a receipt's signed URL stays valid, in seconds (one hour). */
const SIGNED_URL_TTL_SECONDS = 3600

/**
 * Loads and mutates the household's deduction receipts. Rows come from the
 * `deduction_receipt` table (RLS-scoped to the household); the files sit in the
 * private `receipts` Storage bucket, laid out as
 * `<household_id>/<deduction_id>/<uuid>-<file>` so the first path segment gates
 * access to the owning household.
 *
 * `upload`/`remove`/`rename` act on an already-real deduction — the edit flow,
 * and every receipt shown against an existing deduction; `rename` only ever
 * touches `file_name`, the display label, never `storage_path` or the stored
 * file. `uploadPending`/`discardPending`/`extract` are the create flow's own: a
 * receipt picked before the deduction row exists uploads to Storage alone (no
 * `deduction_receipt` row, since `deduction_id` is a real foreign key), reads
 * through `deduction-extract` to pre-fill the add form, and is written into a
 * `deduction_receipt` row only when `create_deduction_with_receipts` creates
 * the deduction itself.
 */
export function useDeductionReceipts(householdId: string): UseDeductionReceiptsResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'deduction_receipt',
    DeductionReceiptInput,
    DeductionReceiptRenameInput
  >(householdId, { table: 'deduction_receipt', orderBy: 'created_at' })

  const uploadFile = useCallback(
    async (deductionId: string, file: File): Promise<PendingReceipt> => {
      const path = `${householdId}/${deductionId}/${crypto.randomUUID()}-${file.name}`
      const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file)
      if (error) {
        throw error
      }
      return { storage_path: path, file_name: file.name }
    },
    [householdId],
  )

  const upload = useCallback(
    async (deductionId: string, file: File) => {
      const { storage_path, file_name } = await uploadFile(deductionId, file)
      await create({ deduction_id: deductionId, storage_path, file_name })
    },
    [uploadFile, create],
  )

  const uploadPending = uploadFile

  const discardPending = useCallback(async (path: string) => {
    try {
      const { error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([path])
      if (error) {
        throw error
      }
    } catch {
      // An object nobody references is litter, not a failure the member can
      // act on, so cleaning up never surfaces as a form error.
    }
  }, [])

  const extract = useCallback(async (path: string): Promise<ExtractionOutcome> => {
    const { data, error, response } = await supabase.functions.invoke<unknown>(
      'deduction-extract',
      { body: { path } },
    )
    if (error) {
      // A non-2xx carries the function's own specific message as JSON; a
      // transport failure carries no response at all.
      const body = response ? await response.json().catch(() => null) : null
      return readExtractionFailure(body)
    }
    // A 2xx body is read rather than trusted, so a reply the form cannot render
    // reads as a plain failure instead of throwing partway through the note.
    const extraction = readExtraction(data)
    return extraction === null
      ? { status: 'failed', message: EXTRACTION_FAILED_MESSAGE }
      : { status: 'read', extraction }
  }, [])

  const removeReceipt = useCallback(
    async (receipt: DeductionReceiptRow) => {
      const { error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([receipt.storage_path])
      if (error) {
        throw error
      }
      await remove(receipt.id)
    },
    [remove],
  )

  const rename = useCallback(
    async (receipt: DeductionReceiptRow, fileName: string) => {
      await update(receipt.id, { file_name: fileName })
    },
    [update],
  )

  const signedUrl = useCallback(async (path: string) => {
    const { data, error } = await supabase.storage
      .from(RECEIPTS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    if (error) {
      return null
    }
    return data.signedUrl
  }, [])

  return {
    receipts: rows,
    loading,
    reload,
    upload,
    remove: removeReceipt,
    rename,
    signedUrl,
    uploadPending,
    discardPending,
    extract,
  }
}
