import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeductionExtraction, ExtractionFailure } from '../lib/deductionExtraction'
import type { PrefillSummary } from './useDeductionFields'
import type { PendingReceipt } from './useDeductionReceipts'

/** What the form says when a receipt itself could not be stored. */
export const UPLOAD_FAILED_MESSAGE =
  'Could not upload this receipt. Try again, or enter the details by hand.'

/** Where attaching receipts and reading the first one has got to. */
export type ExtractionState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'reading' }
  | ({ status: 'read' } & PrefillSummary)
  | ExtractionFailure

export interface DeductionAttachments {
  /** Uploads `file` under `deductionId` in Storage, without a `deduction_receipt` row. */
  upload: (deductionId: string, file: File) => Promise<PendingReceipt>
  /**
   * Deletes an uploaded object no deduction references — one the member
   * removed, or walked away from before saving. Best effort: a failure leaves
   * an unreferenced object behind, which is not worth failing the form over.
   */
  discard: (path: string) => Promise<void>
  /** Reads an uploaded receipt through `deduction-extract` so the form can pre-fill. */
  read: (
    path: string,
  ) => Promise<{ status: 'read'; extraction: DeductionExtraction } | ExtractionFailure>
}

export interface UseDeductionAttachmentResult {
  /**
   * The id the receipts are filed under: minted once, when the add form opens,
   * and unchanged for the life of the form — so every receipt's path sits in
   * the same prefix the deduction row is ultimately written under.
   */
  deductionId: string
  /** Every receipt uploaded so far, for the picker's own list. */
  files: readonly PendingReceipt[]
  state: ExtractionState
  /** Whether a receipt is being stored or the first one read, so the picker holds still. */
  busy: boolean
  /** Uploads a newly picked file and, for the first one, reads it. */
  addFile: (file: File) => Promise<void>
  /** Removes an uploaded file, deleting its Storage object. */
  removeFile: (path: string) => Promise<void>
  /** Marks every uploaded file saved, so leaving the form no longer deletes them. */
  keep: () => void
}

interface UseDeductionAttachmentOptions {
  attachments: DeductionAttachments
  /** Applies a successful read to the form's fields, reporting what it did. */
  onExtracted: (extraction: DeductionExtraction) => PrefillSummary
}

/**
 * Attaching one or more receipts to a deduction being added, and reading the
 * figures off the first one.
 *
 * Each file is stored **before** the deduction row exists: `create_deduction_
 * with_receipts` takes the already-uploaded paths, and Storage has no foreign
 * key, so an upload is safe ahead of the row. The deduction id is minted here,
 * the moment the add form opens, so every file lands inside the prefix the row
 * is eventually written under. Only the first successfully uploaded file is
 * read — a second and further reads would each try to overwrite the same
 * fields, so one confirmed read is what the form works from.
 *
 * A file the member removes, or leaves behind when the form is cancelled or
 * closed, is deleted again, best effort — a delete that fails is swallowed,
 * and a closed tab runs no cleanup at all.
 */
export function useDeductionAttachment({
  attachments,
  onExtracted,
}: UseDeductionAttachmentOptions): UseDeductionAttachmentResult {
  const [deductionId] = useState(() => crypto.randomUUID())
  const [files, setFiles] = useState<PendingReceipt[]>([])
  const [state, setState] = useState<ExtractionState>({ status: 'idle' })

  // Files uploaded but not yet referenced by a saved deduction. Held in a ref
  // so unmount cleanup sees the latest set without re-running on every change.
  const pending = useRef<PendingReceipt[]>([])
  // Set once the form is gone, so an upload that lands afterwards is deleted
  // rather than left behind: until it resolves there is no path to clean up.
  const gone = useRef(false)
  const discard = useRef(attachments.discard)
  discard.current = attachments.discard
  // Held the same way, so memoising `addFile` is real rather than defeated by a
  // caller whose callback changes identity every render.
  const extracted = useRef(onExtracted)
  extracted.current = onExtracted

  useEffect(
    () => () => {
      gone.current = true
      const abandoned = pending.current
      pending.current = []
      for (const file of abandoned) {
        void discard.current(file.storage_path)
      }
    },
    [],
  )

  const addFile = useCallback(
    async (file: File) => {
      const isFirst = files.length === 0
      if (isFirst) {
        setState({ status: 'uploading' })
      }

      let stored: PendingReceipt
      try {
        stored = await attachments.upload(deductionId, file)
      } catch {
        if (isFirst) {
          setState({ status: 'failed', message: UPLOAD_FAILED_MESSAGE })
        }
        return
      }
      if (gone.current) {
        // The form left while the upload was in flight, so its cleanup found no
        // path to delete; this one is that object, and nothing will reference it.
        void discard.current(stored.storage_path)
        return
      }
      pending.current = [...pending.current, stored]
      setFiles((current) => [...current, stored])

      if (!isFirst) {
        // Only the first file is read: a second read would try to overwrite the
        // same fields the first one already filled.
        return
      }

      setState({ status: 'reading' })
      const outcome = await attachments.read(stored.storage_path)
      if (gone.current) {
        return
      }
      if (outcome.status !== 'read') {
        setState(outcome)
        return
      }
      setState({ status: 'read', ...extracted.current(outcome.extraction) })
    },
    [attachments, deductionId, files.length],
  )

  const removeFile = useCallback(async (path: string) => {
    pending.current = pending.current.filter((file) => file.storage_path !== path)
    setFiles((current) => current.filter((file) => file.storage_path !== path))
    await discard.current(path)
  }, [])

  const keep = useCallback(() => {
    pending.current = []
  }, [])

  return {
    deductionId,
    files,
    state,
    busy: state.status === 'uploading' || state.status === 'reading',
    addFile,
    removeFile,
    keep,
  }
}
