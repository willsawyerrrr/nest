import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExtractionFailure, PayslipExtraction } from '../lib/payslipExtraction'
import type { PrefillSummary } from './usePayslipFields'
import type { LinePrefillSummary } from './usePayslipLineDrafts'
import type { PayslipAttachment, PayslipAttachments } from './usePayslips'

/** What the form says when the document itself could not be stored. */
export const UPLOAD_FAILED_MESSAGE =
  'Could not upload this document. Try again, or enter the figures by hand.'

/** What one read did, across the slip's own figures and its itemised lines. */
export type PayslipPrefillSummary = PrefillSummary & LinePrefillSummary

/** Where attaching a slip and reading it has got to. */
export type ExtractionState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'reading' }
  | ({ status: 'read' } & PayslipPrefillSummary)
  | ExtractionFailure

export interface UsePayslipAttachmentResult {
  /**
   * The id the slip is filed under: the payslip being edited, or the one minted
   * when the form opened. Stable for the life of the form, so the document's
   * prefix and the row the save writes carry the same id however many times the
   * member presses Save.
   */
  payslipId: string
  /** The chosen file, for the picker's own value. */
  file: File | null
  /** Where the chosen file landed, or null when nothing new is attached. */
  attachment: PayslipAttachment | null
  state: ExtractionState
  /** Whether the slip is being stored or read, so the picker holds still. */
  busy: boolean
  /** Stores a newly chosen slip and reads it, or clears the one attached. */
  choose: (file: File | null) => Promise<void>
  /** Marks the attachment saved, so leaving the form no longer deletes it. */
  keep: () => void
}

interface UsePayslipAttachmentOptions {
  attachments: PayslipAttachments
  /** The payslip being edited, or null for one not yet created. */
  payslipId: string | null
  /** Applies a successful read to the form's fields and lines, reporting what it did. */
  onExtracted: (extraction: PayslipExtraction) => PayslipPrefillSummary
}

/**
 * Attaching a payslip document, and reading the figures off it.
 *
 * The document is stored **before** it is read, because extraction takes an
 * object path and because the file is the auditable record whether or not the
 * read succeeds. So the upload runs when the file is picked: the payslip id is
 * minted here and the object filed under it straight away, which puts it at its
 * final key with nothing to move on save.
 *
 * An object stored for a row that is never written would be litter that no
 * payslip references, so one is deleted as soon as the member clears it,
 * replaces it, or leaves the form. Cleanup is best effort — a delete that fails
 * is swallowed, and a closed tab runs none of it.
 *
 * Nothing here can stop a save: every failure resolves into a state the form
 * shows beside the still-editable figures.
 */
export function usePayslipAttachment({
  attachments,
  payslipId,
  onExtracted,
}: UsePayslipAttachmentOptions): UsePayslipAttachmentResult {
  // A payslip being edited already has its id; a new one gets its own now, so
  // the document lands inside the prefix the row will be written under.
  const [id] = useState(() => payslipId ?? crypto.randomUUID())
  const [file, setFile] = useState<File | null>(null)
  const [attachment, setAttachment] = useState<PayslipAttachment | null>(null)
  const [state, setState] = useState<ExtractionState>({ status: 'idle' })

  // The object stored but not yet referenced by a saved row. Held in a ref so
  // unmount cleanup sees the latest one without re-running on every change.
  const orphan = useRef<string | null>(null)
  // Set once the form is gone, so an upload that lands afterwards is deleted
  // rather than left behind: until it resolves there is no path to clean up.
  const gone = useRef(false)
  const discard = useRef(attachments.discard)
  discard.current = attachments.discard
  // Held the same way, so memoising `choose` is real rather than defeated by a
  // caller whose callback changes identity every render.
  const extracted = useRef(onExtracted)
  extracted.current = onExtracted

  useEffect(
    () => () => {
      gone.current = true
      const abandoned = orphan.current
      orphan.current = null
      if (abandoned !== null) {
        void discard.current(abandoned)
      }
    },
    [],
  )

  const release = useCallback(async () => {
    const abandoned = orphan.current
    orphan.current = null
    if (abandoned !== null) {
      await discard.current(abandoned)
    }
  }, [])

  const choose = useCallback(
    async (next: File | null) => {
      setFile(next)
      setAttachment(null)
      setState(next === null ? { status: 'idle' } : { status: 'uploading' })
      await release()
      if (next === null) {
        return
      }

      let stored: PayslipAttachment
      try {
        stored = await attachments.upload(id, next)
      } catch {
        setFile(null)
        setState({ status: 'failed', message: UPLOAD_FAILED_MESSAGE })
        return
      }
      if (gone.current) {
        // The form left while the upload was in flight, so its cleanup found no
        // path to delete; this one is that object, and nothing will reference it.
        void discard.current(stored.path)
        return
      }
      orphan.current = stored.path
      setAttachment(stored)
      setState({ status: 'reading' })

      // A read that fails leaves the document attached: it is the record, and
      // the figures are typed either way.
      const outcome = await attachments.read(stored.path)
      if (gone.current) {
        return
      }
      if (outcome.status !== 'read') {
        setState(outcome)
        return
      }
      setState({ status: 'read', ...extracted.current(outcome.extraction) })
    },
    [attachments, id, release],
  )

  const keep = useCallback(() => {
    orphan.current = null
  }, [])

  return {
    payslipId: id,
    file,
    attachment,
    state,
    busy: state.status === 'uploading' || state.status === 'reading',
    choose,
    keep,
  }
}
