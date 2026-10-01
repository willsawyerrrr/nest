import type { Inflow } from '../hooks/useInflows'
import type { usePayslipQueue } from '../hooks/usePayslipQueue'
import type { PayslipAttachments, PayslipSubmission } from '../hooks/usePayslips'
import { BulkUploadPanel } from './BulkUploadPanel'
import { PayslipForm } from './PayslipForm'

interface PayslipImportProps {
  /** The documents added from the Add payslip card, from `usePayslipQueue`. */
  queue: ReturnType<typeof usePayslipQueue>
  member: { id: string; name: string }
  inflows: readonly Inflow[]
  /** Storing, discarding, and reading the documents. */
  attachments: PayslipAttachments
  onCreate: (submission: PayslipSubmission) => Promise<void>
}

/**
 * Reviews the payslips read from the several documents added at once from the Add
 * payslip card. Each document has its own payslip draft — figures and itemised
 * lines pre-filled for the member to check against it — saved, edited, or
 * discarded on its own. The financial year of each is derived from its own dates.
 */
export function PayslipImport({
  queue,
  member,
  inflows,
  attachments,
  onCreate,
}: PayslipImportProps) {
  return (
    <BulkUploadPanel
      queue={queue}
      renderDraft={(item, controls) => (
        <PayslipForm
          member={member}
          inflows={inflows}
          attachments={attachments}
          draft={{ id: item.id, path: item.path!, extraction: item.value }}
          cancelLabel="Discard"
          onSubmit={(submission) => controls.save(() => onCreate(submission))}
          onCancel={controls.discard}
        />
      )}
    />
  )
}
