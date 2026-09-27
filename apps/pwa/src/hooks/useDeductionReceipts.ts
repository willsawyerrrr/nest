import { useCallback } from 'react'
import { financialYearForDate } from '@nest/tax'
import { useHouseholdId } from '../components/HouseholdProvider'
import type { Tables } from '../lib/database.types'
import {
  EXTRACTION_FAILED_MESSAGE,
  readExtraction,
  readExtractionFailure,
  type ExtractionOutcome,
} from '../lib/deductionExtraction'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection } from './useCollection'
import type { DeductionCategory } from './useDeductions'

export type DeductionReceiptRow = Tables<'deduction_receipt'>

/** The `deduction_receipt` fields an upload supplies; the household is set by the hook. */
interface DeductionReceiptInput {
  deduction_id: string
  storage_path: string
}

/** The one field a replacement changes: the object the receipt points at. */
interface DeductionReceiptReplaceInput {
  storage_path: string
}

/** The private Storage bucket receipt files live in. */
const RECEIPTS_BUCKET = 'receipts'

export interface UseDeductionReceiptsResult {
  receipts: DeductionReceiptRow[] | null
  loading: boolean
  reload: () => Promise<void>
  /**
   * Attaches `file` as a deduction's receipt: uploads it and records a receipt
   * row pointing at it, or — where `existing` is the deduction's current
   * receipt — repoints that row and deletes the object it held, best effort.
   */
  upload: (deductionId: string, file: File, existing?: DeductionReceiptRow) => Promise<void>
  /** Removes a receipt's stored file and its row. */
  remove: (receipt: DeductionReceiptRow) => Promise<void>
  /** A short-lived signed URL for viewing a stored receipt, or null on failure. */
  signedUrl: (path: string) => Promise<string | null>
  /**
   * Uploads `file` under `deductionId` in Storage without a `deduction_receipt`
   * row — for a deduction not yet created, whose receipt is written together
   * with it by `create_deduction_with_receipt`. Resolves to the object's path.
   */
  uploadPending: (deductionId: string, file: File) => Promise<string>
  /**
   * Deletes an uploaded object no deduction references — one the member
   * removed, or walked away from before saving the deduction. Best effort: a
   * failure is swallowed, not surfaced to the form.
   */
  discardPending: (path: string) => Promise<void>
  /**
   * Reads an uploaded receipt through `deduction-extract` so the add form can
   * pre-fill. `category` primes the model for the kind of document that
   * category expects — a purchase receipt/invoice for `work_expense`, a
   * donation tax receipt for `donation`, an invoice for `tax_agent_fees`.
   */
  extract: (path: string, category: DeductionCategory) => Promise<ExtractionOutcome>
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
 * `upload`/`remove` act on an already-real deduction — attaching, replacing, or
 * removing the receipt shown against an existing deduction. `uploadPending`/`discardPending`/`extract` are the create flow's own: a
 * receipt picked before the deduction row exists uploads to Storage alone (no
 * `deduction_receipt` row, since `deduction_id` is a real foreign key), reads
 * through `deduction-extract` to pre-fill the add form, and is written into a
 * `deduction_receipt` row only when `create_deduction_with_receipt` creates
 * the deduction itself.
 *
 * `financialYear` (defaulting to the current one) is passed to
 * `deduction-extract` so a receipt printing a yearless date resolves within it.
 */
export function useDeductionReceipts(
  financialYear: number = financialYearForDate(new Date()),
): UseDeductionReceiptsResult {
  const householdId = useHouseholdId()
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'deduction_receipt',
    DeductionReceiptInput,
    DeductionReceiptReplaceInput
  >({ table: 'deduction_receipt', orderBy: 'created_at' })

  const uploadFile = useCallback(
    async (deductionId: string, file: File): Promise<string> => {
      const path = `${householdId}/${deductionId}/${crypto.randomUUID()}-${file.name}`
      const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file)
      if (error) {
        throw error
      }
      return path
    },
    [householdId],
  )

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

  const upload = useCallback(
    async (deductionId: string, file: File, existing?: DeductionReceiptRow) => {
      const storage_path = await uploadFile(deductionId, file)
      if (!existing) {
        await create({ deduction_id: deductionId, storage_path })
        return
      }
      await update(existing.id, { storage_path })
      await discardPending(existing.storage_path)
    },
    [uploadFile, create, update, discardPending],
  )

  const uploadPending = uploadFile

  const extract = useCallback(
    async (path: string, category: DeductionCategory): Promise<ExtractionOutcome> => {
      const { data, error, response } = await supabase.functions.invoke<unknown>(
        'deduction-extract',
        { body: { path, category, financialYear } },
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
    },
    [financialYear],
  )

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
    signedUrl,
    uploadPending,
    discardPending,
    extract,
  }
}
