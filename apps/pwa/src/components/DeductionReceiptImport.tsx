import { useRef, useState } from 'react'
import { Stack, Text } from '@mantine/core'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionCategory, DeductionSubmission } from '../hooks/useDeductions'
import { useUploadQueue } from '../hooks/useUploadQueue'
import { EXTRACTION_UNSUPPORTED_MESSAGE, toReadResult } from '../lib/deductionExtraction'
import { BulkUploadPanel } from './BulkUploadPanel'
import { DeductionForm } from './DeductionForm'
import { EnumSegmentedControl } from './EnumSelect'

interface DeductionReceiptImportProps {
  member: { id: string; name: string }
  /** Storing, discarding, and reading the receipts. */
  attachments: DeductionAttachments
  financialYear: number
  groups: DeductionGroupRow[]
  onCreate: (submission: DeductionSubmission) => Promise<void>
}

/** The kinds of deduction a batch of receipts can be read as. */
const CATEGORY_OPTIONS: { value: DeductionCategory; label: string }[] = [
  { value: 'work_expense', label: 'Work expenses' },
  { value: 'donation', label: 'Donation receipts' },
  { value: 'tax_agent_fees', label: 'Tax agent invoices' },
]

/**
 * Adds many deductions from many receipts. Each receipt is stored and read into
 * its own deduction draft — description, amount, and date pre-filled for the
 * member to check — and saved, edited, or discarded on its own. The kind chosen
 * when a receipt is added primes the reading for that kind of document and is the
 * draft's starting category.
 */
export function DeductionReceiptImport({
  member,
  attachments,
  financialYear,
  groups,
  onCreate,
}: DeductionReceiptImportProps) {
  const [category, setCategory] = useState<DeductionCategory>('work_expense')
  const act = useRef(attachments)
  act.current = attachments

  const queue = useUploadQueue({
    upload: (id, file) => act.current.upload(id, file),
    discard: (path) => act.current.discard(path),
    read: async (path, _file, kind: DeductionCategory) =>
      toReadResult(await act.current.read(path, kind)),
    blank: () => null,
    unsupportedMessage: EXTRACTION_UNSUPPORTED_MESSAGE,
  })

  return (
    <BulkUploadPanel
      queue={queue}
      noun="receipts"
      pickerLabel={`Add ${member.name}'s deductions from receipts`}
      meta={category}
      controls={
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Add several receipts at once; each is read into its own deduction to check. What kind
            are the receipts you add next?
          </Text>
          <EnumSegmentedControl
            fullWidth
            size="xs"
            aria-label="What kind of receipts?"
            value={category}
            onChange={setCategory}
            data={CATEGORY_OPTIONS}
          />
        </Stack>
      }
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
