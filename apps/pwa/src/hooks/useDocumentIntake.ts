import { useCallback } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdCollection } from './useCollection'

export type DocumentIntakeRow = Tables<'document_intake'>

/** The private Storage bucket a Shortcut's upload lands in, staged ahead of review. */
const BUCKET = 'document-intake'

export interface UseDocumentIntakeResult {
  /** Every staged document the household has, most recently uploaded first; null while loading. */
  items: DocumentIntakeRow[] | null
  loading: boolean
  reload: () => Promise<void>
  /** Downloads a staged item's file, ready to hand to the add-payslip/add-deduction form exactly as a picked file would be. */
  download: (item: DocumentIntakeRow) => Promise<File>
  /**
   * Deletes a staged item's object and row: called once it has become a real
   * payslip or deduction (the form's own upload already copied the file into
   * `payslips`/`receipts`, so this one is now redundant) or the member
   * dismisses it outright. Best effort on the Storage side, matching every
   * other cleanup in the app: a delete that fails leaves an object nothing
   * references rather than blocking the member.
   */
  clear: (item: DocumentIntakeRow) => Promise<void>
}

/**
 * The household's staged document-intake uploads — files an iOS Shortcut
 * posted from outside the PWA, awaiting review from the Payslips or Deductions
 * tab. Household-wide, exactly as the rows they will become (`payslip` /
 * `deduction`) are: `member_id` names who the document is for, not who may see
 * it.
 */
export function useDocumentIntake(householdId: string): UseDocumentIntakeResult {
  const { rows, loading, reload, remove } = useHouseholdCollection<'document_intake', never>(
    householdId,
    { table: 'document_intake', orderBy: 'created_at', descending: true },
  )

  const download = useCallback(async (item: DocumentIntakeRow): Promise<File> => {
    const { data, error } = await supabase.storage.from(BUCKET).download(item.storage_path)
    if (error || !data) {
      throw error ?? new Error('Could not download this document.')
    }
    const filename = item.original_filename ?? item.storage_path.split('/').pop() ?? 'document'
    return new File([data], filename, data.type ? { type: data.type } : {})
  }, [])

  const clear = useCallback(
    async (item: DocumentIntakeRow) => {
      try {
        await supabase.storage.from(BUCKET).remove([item.storage_path])
      } catch {
        // An object nobody references is litter, not a failure the member can
        // act on — the same swallow-on-fail every other attachment cleanup uses.
      }
      await remove(item.id)
    },
    [remove],
  )

  return { items: rows, loading, reload, download, clear }
}
