import { useMemo } from 'react'
import { DeductionsScreen } from '../components/DeductionsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import { useDeductionReceipts } from '../hooks/useDeductionReceipts'
import { useDeductions } from '../hooks/useDeductions'
import { useMembers } from '../hooks/useMembers'

export function DeductionsSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const deductions = useDeductions(householdId)
  const receipts = useDeductionReceipts(householdId)

  // Storing, discarding, and reading a receipt picked before a new deduction
  // exists, distinct from `upload`/`remove` which attach a receipt to an
  // already-real deduction.
  const attachments = useMemo<DeductionAttachments>(
    () => ({
      upload: receipts.uploadPending,
      discard: receipts.discardPending,
      read: receipts.extract,
    }),
    [receipts.uploadPending, receipts.discardPending, receipts.extract],
  )

  if (membersLoading || deductions.loading || receipts.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <DeductionsScreen
      members={members}
      deductions={deductions.deductions ?? []}
      receipts={receipts.receipts ?? []}
      financialYear={deductions.financialYear}
      attachments={attachments}
      onCreate={deductions.create}
      onUpdate={deductions.update}
      onDelete={deductions.remove}
      onUploadReceipt={receipts.upload}
      onRemoveReceipt={receipts.remove}
      onRenameReceipt={receipts.rename}
      signedUrl={receipts.signedUrl}
    />
  )
}
