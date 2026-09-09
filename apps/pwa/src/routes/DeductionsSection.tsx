import { useMemo, useState } from 'react'
import { financialYearForDate } from '@nest/tax'
import { DeductionsScreen } from '../components/DeductionsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import { useDeductionGroups } from '../hooks/useDeductionGroups'
import { useDeductionReceipts } from '../hooks/useDeductionReceipts'
import { useDeductions } from '../hooks/useDeductions'
import { useMembers } from '../hooks/useMembers'
import { availableFinancialYears } from '../lib/tax'

export function DeductionsSection() {
  const [financialYear, setFinancialYear] = useState(financialYearForDate(new Date()))

  const { members, loading: membersLoading } = useMembers()
  const deductions = useDeductions(financialYear)
  const groups = useDeductionGroups(financialYear)
  const receipts = useDeductionReceipts()

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

  if (membersLoading || deductions.loading || groups.loading || receipts.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <DeductionsScreen
      members={members}
      deductions={deductions.deductions ?? []}
      groups={groups.groups ?? []}
      receipts={receipts.receipts ?? []}
      financialYear={financialYear}
      availableFinancialYears={availableFinancialYears}
      onFinancialYearChange={setFinancialYear}
      attachments={attachments}
      onCreate={deductions.create}
      onUpdate={deductions.update}
      onDelete={deductions.remove}
      onCreateGroup={groups.create}
      onUpdateGroup={groups.update}
      onDeleteGroup={groups.remove}
      onUploadReceipt={receipts.upload}
      onRemoveReceipt={receipts.remove}
      onRenameReceipt={receipts.rename}
      signedUrl={receipts.signedUrl}
    />
  )
}
