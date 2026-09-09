import { useState } from 'react'
import { Stack } from '@mantine/core'
import { configsByYear, financialYearForDate } from '@nest/tax'
import { EofyScreen, type EofyPayslipDocument } from '../components/EofyScreen'
import { EofyShareControl } from '../components/EofyShareControl'
import { LoadingScreen } from '../components/LoadingScreen'
import { useDeductionReceipts } from '../hooks/useDeductionReceipts'
import { useDeductions } from '../hooks/useDeductions'
import { useGoals } from '../hooks/useGoals'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { usePayslips } from '../hooks/usePayslips'
import { useSavers } from '../hooks/useSavers'
import { useShareGrant } from '../hooks/useShareGrant'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { paygWithheldFromRows, payslipCountByMember } from '../lib/payslips'
import {
  availableFinancialYears,
  currentTaxConfig,
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  projectedInterestIncomeInputs,
  superCapSummaryFromRows,
} from '../lib/tax'

export function EofySection() {
  const [financialYear, setFinancialYear] = useState(financialYearForDate(new Date()))

  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows()
  const taxProfiles = useTaxProfiles(financialYear)
  const contributions = useSuperContributions(financialYear)
  const superProfiles = useSuperProfiles(financialYear)
  const helpDebts = useHelpDebts()
  const deductions = useDeductions(financialYear)
  const receipts = useDeductionReceipts()
  const payslips = usePayslips(financialYear)
  const goals = useGoals()
  const savers = useSavers()
  const shareGrant = useShareGrant()

  if (
    membersLoading ||
    inflows.loading ||
    taxProfiles.loading ||
    contributions.loading ||
    superProfiles.loading ||
    helpDebts.loading ||
    deductions.loading ||
    receipts.loading ||
    payslips.loading ||
    goals.loading ||
    savers.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  // The selector is built from `configsByYear`, so a config should always be
  // resolvable; falling back to the current year's config is defensive only.
  const config = configsByYear[financialYear] ?? currentTaxConfig()
  const deductionRows = deductions.deductions ?? []
  // The selected year's payslips carry the tax actually withheld, which nets
  // against each member's liability so the balance this filing-prep view reports
  // is the real refund or bill — the same figure the Tax tab shows for the year.
  const payslipRows = payslips.payslips ?? []
  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
    helpDebts.helpDebts ?? [],
    deductionRows,
    config,
    paygWithheldFromRows(payslipRows),
    members,
    projectedInterestIncomeInputs(goals.goals ?? [], savers.savers ?? [], members),
  )
  const capSummaries = superCapSummaryFromRows(
    inflows.inflows ?? [],
    superProfiles.profiles ?? [],
    contributions.contributions ?? [],
    config,
  )
  const helpPayoff = helpPayoffByMember(estimate, helpDebts.helpDebts ?? [], config)

  // Receipts join on `deduction_id`, not `financial_year`, so the selected FY's
  // receipts are those belonging to a deduction already loaded for that FY.
  const deductionIds = new Set(deductionRows.map((deduction) => deduction.id))
  const receiptRows = (receipts.receipts ?? []).filter((receipt) =>
    deductionIds.has(receipt.deduction_id),
  )

  // Only slips with an attached document have anything for this section to link.
  const payslipDocuments: EofyPayslipDocument[] = payslipRows.flatMap((payslip) =>
    payslip.file_path
      ? [
          {
            id: payslip.id,
            memberId: payslip.member_id,
            paidOn: payslip.paid_on,
            filePath: payslip.file_path,
          },
        ]
      : [],
  )

  return (
    <Stack gap="md">
      <EofyShareControl
        status={shareGrant.status}
        financialYear={financialYear}
        availableFinancialYears={availableFinancialYears}
        onCreate={shareGrant.create}
        onRevoke={shareGrant.revoke}
      />
      <EofyScreen
        members={members}
        financialYear={financialYear}
        availableFinancialYears={availableFinancialYears}
        onFinancialYearChange={setFinancialYear}
        estimate={estimate}
        capSummaries={capSummaries}
        helpDebts={helpDebts.helpDebts ?? []}
        helpPayoff={helpPayoff}
        deductions={deductionRows}
        payslipCounts={payslipCountByMember(payslipRows)}
        receipts={receiptRows}
        signedUrl={receipts.signedUrl}
        payslipDocuments={payslipDocuments}
        payslipSignedUrl={payslips.signedUrl}
      />
    </Stack>
  )
}
