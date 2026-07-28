import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExtractionFailure, PayslipExtraction } from '../lib/payslipExtraction'
import type { PrefillSummary } from './usePayslipFields'
import type { PayslipAttachment, PayslipAttachments } from './usePayslips'

/** What the form says when the document itself could not be stored. */
export const UPLOAD_FAILED_MESSAGE =
  'Could not upload this document. Try again, or enter the figures by hand.'

/** Where attaching a slip and reading it has got to. */
export type ExtractionState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'reading' }
  | ({ status: 'read'; extraction: PayslipExtraction } & PrefillSummary)
  | ExtractionFailure

export interface UsePayslipAttachmentResult {
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
  /** Applies a successful read to the form's fields and reports what it did. */
  onExtracted: (extraction: PayslipExtraction) => PrefillSummary
}

/**
 * Attaching a payslip document, and reading the figures off it.
 *
 * The document is stored **before** it is read, because extraction takes an
 * object path and because the file is the auditable record whether or not the
 * read succeeds. That inverts the usual order — the upload runs when the file is
 * picked, not when the form is saved — so the payslip id is minted here and the
 * object filed under it straight away, leaving nothing to move on save.
 *
 * An object stored for a row that is never written would be litter no payslip
 * references, so one is deleted as soon as the member clears it, replaces it, or
 * leaves the form. `keep` is what makes it permanent, called once the save that
 * references it succeeds.
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
  const discard = useRef(attachments.discard)
  discard.current = attachments.discard

  useEffect(
    () => () => {
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
      orphan.current = stored.path
      setAttachment(stored)
      setState({ status: 'reading' })

      // A read that fails leaves the document attached: it is the record, and
      // the figures are typed either way.
      const outcome = await attachments.read(stored.path)
      if (outcome.status !== 'read') {
        setState(outcome)
        return
      }
      setState({
        status: 'read',
        extraction: outcome.extraction,
        ...onExtracted(outcome.extraction),
      })
    },
    [attachments, id, onExtracted, release],
  )

  const keep = useCallback(() => {
    orphan.current = null
  }, [])

  return {
    file,
    attachment,
    state,
    busy: state.status === 'uploading' || state.status === 'reading',
    choose,
    keep,
  }
}
