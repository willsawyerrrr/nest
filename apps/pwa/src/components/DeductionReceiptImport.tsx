import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { useDeductionReceiptQueue } from '../hooks/useDeductionReceiptQueue'
import type { DeductionSubmission } from '../hooks/useDeductions'
import { BulkUploadPanel } from './BulkUploadPanel'
import { DeductionForm } from './DeductionForm'

interface DeductionReceiptImportProps {
  /** The receipts added from the Add deduction card, from `useDeductionReceiptQueue`. */
  queue: ReturnType<typeof useDeductionReceiptQueue>
  member: { id: string; name: string }
  /** Storing, discarding, and reading the receipts. */
  attachments: DeductionAttachments
  financialYear: number
  groups: DeductionGroupRow[]
  onCreate: (submission: DeductionSubmission) => Promise<void>
}

/**
 * Reviews the deductions read from the several receipts added at once from the
 * Add deduction card. Each receipt has its own deduction draft — description,
 * amount, and date pre-filled for the member to check — saved, edited, or
 * discarded on its own. The kind chosen on the card primes the reading for that
 * kind of document and is the draft's starting category.
 */
export function DeductionReceiptImport({
  queue,
  member,
  attachments,
  financialYear,
  groups,
  onCreate,
}: DeductionReceiptImportProps) {
  return (
    <BulkUploadPanel
      queue={queue}
      renderDraft={(item, controls) => (
        <DeductionForm
          member={member}
          attachments={attachments}
          financialYear={financialYear}
          groups={groups}
          draft={{
            id: item.id,
            path: item.path!,
            extraction: item.value,
            category: item.meta,
          }}
          cancelLabel="Discard"
          onSubmit={(submission) => controls.save(() => onCreate(submission))}
          onCancel={controls.discard}
        />
      )}
    />
  )
}
