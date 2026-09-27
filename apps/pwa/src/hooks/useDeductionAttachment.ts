import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeductionExtraction, ExtractionFailure } from '../lib/deductionExtraction'
import type { PrefillSummary } from './useDeductionFields'
import type { DeductionCategory } from './useDeductions'

/** What the form says when a receipt itself could not be stored. */
export const UPLOAD_FAILED_MESSAGE =
  'Could not upload this receipt. Try again, or enter the details by hand.'

/** Where attaching the receipt and reading it has got to. */
export type ExtractionState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'reading' }
  | ({ status: 'read' } & PrefillSummary)
  | ExtractionFailure

export interface DeductionAttachments {
  /** Uploads `file` under `deductionId` in Storage, without a `deduction_receipt` row. */
  upload: (deductionId: string, file: File) => Promise<string>
  /**
   * Deletes an uploaded object no deduction references — one the member
   * removed or replaced, or walked away from before saving. Best effort: a failure leaves
   * an unreferenced object behind, which is not worth failing the form over.
   */
  discard: (path: string) => Promise<void>
  /**
   * Reads an uploaded receipt through `deduction-extract` so the form can
   * pre-fill, primed for the category's expected kind of document.
   */
  read: (
    path: string,
    category: DeductionCategory,
  ) => Promise<{ status: 'read'; extraction: DeductionExtraction } | ExtractionFailure>
}

export interface UseDeductionAttachmentResult {
  /**
   * The id the receipt is filed under: minted once, when the add form opens,
   * and unchanged for the life of the form — so the receipt's path sits in
   * the prefix the deduction row is ultimately written under.
   */
  deductionId: string
  /** The uploaded receipt's Storage path, or null while none is attached. */
  path: string | null
  state: ExtractionState
  /** Whether the receipt is being stored or read, so the picker holds still. */
  busy: boolean
  /** Uploads a newly picked file, replacing any already attached, and reads it. */
  addFile: (file: File) => Promise<void>
  /** Removes the uploaded file, deleting its Storage object. */
  removeFile: () => Promise<void>
  /** Marks the uploaded file saved, so leaving the form no longer deletes it. */
  keep: () => void
}

interface UseDeductionAttachmentOptions {
  attachments: DeductionAttachments
  /**
   * The deduction's category at the moment a file is read — chosen on the form
   * before the file is picked, so extraction is primed for the right kind of
   * document from the start. Read at read-time via a ref (see `extracted`
   * below), so a render that changes it before the read completes is not lost.
   */
  category: DeductionCategory
  /** Applies a successful read to the form's fields, reporting what it did. */
  onExtracted: (extraction: DeductionExtraction) => PrefillSummary
}

/**
 * Attaching a receipt to a deduction being added, and reading the figures off it.
 *
 * The file is stored **before** the deduction row exists: `create_deduction_
 * with_receipt` takes the already-uploaded path, and Storage has no foreign
 * key, so an upload is safe ahead of the row. The deduction id is minted here,
 * the moment the add form opens, so the file lands inside the prefix the row
 * is eventually written under. Picking another file replaces the first: the
 * earlier object is deleted and the new one is read.
 *
 * A file the member removes or replaces, or leaves behind when the form is
 * cancelled or closed, is deleted again, best effort — a delete that fails is
 * swallowed, and a closed tab runs no cleanup at all.
 *
 * The read is primed with the deduction's `category`, chosen on the form
 * before the file is picked, so extraction expects the right kind of document
 * from the start rather than rejecting a genuine donation tax receipt for not
 * being a purchase receipt.
 */
export function useDeductionAttachment({
  attachments,
  category,
  onExtracted,
}: UseDeductionAttachmentOptions): UseDeductionAttachmentResult {
  const [deductionId] = useState(() => crypto.randomUUID())
  const [path, setPath] = useState<string | null>(null)
  const [state, setState] = useState<ExtractionState>({ status: 'idle' })

  // The path uploaded but not yet referenced by a saved deduction. Held in a
  // ref so unmount cleanup sees the latest one without re-running on every change.
  const pending = useRef<string | null>(null)
  // Set once the form is gone, so an upload that lands afterwards is deleted
  // rather than left behind: until it resolves there is no path to clean up.
  const gone = useRef(false)
  const discard = useRef(attachments.discard)
  discard.current = attachments.discard
  // Held the same way, so memoising `addFile` is real rather than defeated by a
  // caller whose callback changes identity every render.
  const extracted = useRef(onExtracted)
  extracted.current = onExtracted
  // The category at the moment the read actually runs, not the one in scope
  // when addFile was memoised.
  const categoryRef = useRef(category)
  categoryRef.current = category

  useEffect(
    () => () => {
      gone.current = true
      const abandoned = pending.current
      pending.current = null
      if (abandoned !== null) {
        void discard.current(abandoned)
      }
    },
    [],
  )

  const addFile = useCallback(
    async (file: File) => {
      setState({ status: 'uploading' })

      let stored: string
      try {
        stored = await attachments.upload(deductionId, file)
      } catch {
        setState({ status: 'failed', message: UPLOAD_FAILED_MESSAGE })
        return
      }
      if (gone.current) {
        // The form left while the upload was in flight, so its cleanup found no
        // path to delete; this one is that object, and nothing will reference it.
        void discard.current(stored)
        return
      }
      const replaced = pending.current
      pending.current = stored
      setPath(stored)
      if (replaced !== null) {
        void discard.current(replaced)
      }

      setState({ status: 'reading' })
      const outcome = await attachments.read(stored, categoryRef.current)
      if (gone.current || pending.current !== stored) {
        return
      }
      if (outcome.status !== 'read') {
        setState(outcome)
        return
      }
      setState({ status: 'read', ...extracted.current(outcome.extraction) })
    },
    [attachments, deductionId],
  )

  const removeFile = useCallback(async () => {
    const removed = pending.current
    pending.current = null
    setPath(null)
    setState({ status: 'idle' })
    if (removed !== null) {
      await discard.current(removed)
    }
  }, [])

  const keep = useCallback(() => {
    pending.current = null
  }, [])

  return {
    deductionId,
    path,
    state,
    busy: state.status === 'uploading' || state.status === 'reading',
    addFile,
    removeFile,
    keep,
  }
}
