import { useCallback } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection } from './useCollection'

export type DeductionReceiptRow = Tables<'deduction_receipt'>

/** The `deduction_receipt` fields an upload supplies; the household is set by the hook. */
interface DeductionReceiptInput {
  deduction_id: string
  storage_path: string
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
  /** A short-lived signed URL for viewing a stored receipt, or null on failure. */
  signedUrl: (path: string) => Promise<string | null>
}

/** How long a receipt's signed URL stays valid, in seconds (one hour). */
const SIGNED_URL_TTL_SECONDS = 3600

/**
 * Loads and mutates the household's deduction receipts. Rows come from the
 * `deduction_receipt` table (RLS-scoped to the household); the files sit in the
 * private `receipts` Storage bucket, laid out as
 * `<household_id>/<deduction_id>/<uuid>-<file>` so the first path segment gates
 * access to the owning household.
 */
export function useDeductionReceipts(householdId: string): UseDeductionReceiptsResult {
  const { rows, loading, reload, create, remove } = useHouseholdCollection<
    'deduction_receipt',
    DeductionReceiptInput
  >(householdId, { table: 'deduction_receipt', orderBy: 'created_at' })

  const upload = useCallback(
    async (deductionId: string, file: File) => {
      const path = `${householdId}/${deductionId}/${crypto.randomUUID()}-${file.name}`
      const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file)
      if (error) {
        throw error
      }
      await create({ deduction_id: deductionId, storage_path: path, file_name: file.name })
    },
    [householdId, create],
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

  return { receipts: rows, loading, reload, upload, remove: removeReceipt, signedUrl }
}
