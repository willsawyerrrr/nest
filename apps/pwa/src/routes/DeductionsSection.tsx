import { DeductionsScreen } from '../components/DeductionsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useDeductionReceipts } from '../hooks/useDeductionReceipts'
import { useDeductions } from '../hooks/useDeductions'
import { useMembers } from '../hooks/useMembers'

export function DeductionsSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const deductions = useDeductions(householdId)
  const receipts = useDeductionReceipts(householdId)

  if (membersLoading || deductions.loading || receipts.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <DeductionsScreen
      members={members}
      deductions={deductions.deductions ?? []}
      receipts={receipts.receipts ?? []}
      financialYear={deductions.financialYear}
      onCreate={deductions.create}
      onUpdate={deductions.update}
      onDelete={deductions.remove}
      onUploadReceipt={receipts.upload}
      onRemoveReceipt={receipts.remove}
      signedUrl={receipts.signedUrl}
    />
  )
}
