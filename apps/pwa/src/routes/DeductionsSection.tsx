import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DeductionsScreen } from '../components/DeductionsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useCurrentMember } from '../hooks/useCurrentMember'
import type { DeductionAttachments } from '../hooks/useDeductionAttachment'
import { useDeductionGroups } from '../hooks/useDeductionGroups'
import { useDeductionReceipts } from '../hooks/useDeductionReceipts'
import { useDeductions } from '../hooks/useDeductions'
import { useDeductedTransactionIds, useSourceTransactions } from '../hooks/useDeductionTransactions'
import { useMembers } from '../hooks/useMembers'
import { useCurrentFinancialYear } from '../hooks/useNow'
import { availableFinancialYears } from '../lib/tax'
import { deductionDraftFromTransaction, isOutflow } from '../lib/transactionDeduction'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `/deductions`, with an optional `?transaction=` naming a transaction to
 * create a deduction from. The form opens for the signed-in member, on the
 * financial year the transaction's date falls in, unless the transaction is not
 * an outflow, is not visible, or already has a deduction.
 */

export function DeductionsSection() {
  const currentFinancialYear = useCurrentFinancialYear()
  const [financialYear, setFinancialYear] = useState(currentFinancialYear)
  const [params, setParams] = useSearchParams()
  const requested = params.get('transaction')
  const transactionId = requested !== null && UUID.test(requested) ? requested : null

  const { members, loading: membersLoading } = useMembers()
  const { member: currentMember } = useCurrentMember()
  const deductions = useDeductions(financialYear)
  const groups = useDeductionGroups(financialYear)
  const receipts = useDeductionReceipts(financialYear)
  const requestedSource = useSourceTransactions(transactionId === null ? [] : [transactionId])
  const deducted = useDeductedTransactionIds()
  const sources = useSourceTransactions(
    (deductions.deductions ?? []).flatMap((deduction) =>
      deduction.transaction_id === null ? [] : [deduction.transaction_id],
    ),
  )

  const fromTransaction = useMemo(() => {
    const transaction =
      transactionId === null ? undefined : requestedSource.transactions[transactionId]
    return transaction &&
      isOutflow(transaction) &&
      deducted.ids &&
      !deducted.ids.has(transaction.id)
      ? deductionDraftFromTransaction(transaction)
      : null
  }, [transactionId, requestedSource.transactions, deducted.ids])

  // The form saves on the year its transaction was posted in, so the screen moves
  // there once when the transaction arrives and leaves the year alone after.
  const draftYear = fromTransaction?.financialYear
  const [arrivedYear, setArrivedYear] = useState<number | undefined>(undefined)
  if (draftYear !== undefined && draftYear !== arrivedYear) {
    setArrivedYear(draftYear)
    setFinancialYear(draftYear)
  }

  const closeTransactionForm = useCallback(
    () =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.delete('transaction')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

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

  if (
    membersLoading ||
    deductions.loading ||
    groups.loading ||
    receipts.loading ||
    requestedSource.loading ||
    deducted.loading ||
    sources.loading ||
    !members
  ) {
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
      sources={sources.transactions}
      fromTransaction={fromTransaction}
      onFromTransactionDone={closeTransactionForm}
      currentMemberId={currentMember?.id ?? null}
      onCreate={deductions.create}
      onUpdate={deductions.update}
      onDelete={deductions.remove}
      onCreateGroup={groups.create}
      onUpdateGroup={groups.update}
      onDeleteGroup={groups.remove}
      onUploadReceipt={receipts.upload}
      onRemoveReceipt={receipts.remove}
      signedUrl={receipts.signedUrl}
    />
  )
}
