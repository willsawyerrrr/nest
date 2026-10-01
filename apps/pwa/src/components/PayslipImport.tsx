import { useRef } from 'react'
import { Text } from '@mantine/core'
import type { Inflow } from '../hooks/useInflows'
import type { PayslipAttachments, PayslipSubmission } from '../hooks/usePayslips'
import { useUploadQueue } from '../hooks/useUploadQueue'
import { EXTRACTION_UNSUPPORTED_MESSAGE, toReadResult } from '../lib/payslipExtraction'
import { BulkUploadPanel } from './BulkUploadPanel'
import { PayslipForm } from './PayslipForm'

interface PayslipImportProps {
  member: { id: string; name: string }
  inflows: readonly Inflow[]
  /** Storing, discarding, and reading the documents. */
  attachments: PayslipAttachments
  onCreate: (submission: PayslipSubmission) => Promise<void>
}

/**
 * Adds many payslips from many documents. Each document is stored and read into
 * its own payslip draft — figures and itemised lines pre-filled for the member to
 * check against it — and saved, edited, or discarded on its own. The financial
 * year of each is derived from its own dates.
 */
export function PayslipImport({ member, inflows, attachments, onCreate }: PayslipImportProps) {
  const act = useRef(attachments)
  act.current = attachments

  const queue = useUploadQueue({
    upload: async (id, file) => (await act.current.upload(id, file)).path,
    discard: (path) => act.current.discard(path),
    read: async (path) => toReadResult(await act.current.read(path)),
    blank: () => null,
    unsupportedMessage: EXTRACTION_UNSUPPORTED_MESSAGE,
  })

  return (
    <BulkUploadPanel
      queue={queue}
      noun="payslips"
      pickerLabel={`Add ${member.name}'s payslips from documents`}
      meta={undefined}
      controls={
        <Text size="xs" c="dimmed">
          Add several payslips at once; each is read into its own payslip to check.
        </Text>
      }
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
