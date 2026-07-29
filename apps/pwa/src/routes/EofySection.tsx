import { useState } from 'react'
import { configsByYear, financialYearForDate } from '@nest/tax'
import { EofyScreen } from '../components/EofyScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useDeductionReceipts } from '../hooks/useDeductionReceipts'
import { useDeductions } from '../hooks/useDeductions'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { usePayslips } from '../hooks/usePayslips'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { paygWithheldFromRows, payslipCountByMember } from '../lib/payslips'
import {
  currentTaxConfig,
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  superCapSummaryFromRows,
} from '../lib/tax'

/** Every financial year with a published tax config, most recent first. */
const AVAILABLE_FINANCIAL_YEARS = Object.keys(configsByYear)
  .map(Number)
  .sort((a, b) => b - a)

export function EofySection({ householdId }: { householdId: string }) {
  const [financialYear, setFinancialYear] = useState(financialYearForDate(new Date()))

  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId, financialYear)
  const contributions = useSuperContributions(householdId, financialYear)
  const superProfiles = useSuperProfiles(householdId, financialYear)
  const helpDebts = useHelpDebts(householdId)
  const deductions = useDeductions(householdId, financialYear)
  const receipts = useDeductionReceipts(householdId)
  const payslips = usePayslips(householdId, financialYear)

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

  return (
    <EofyScreen
      members={members}
      financialYear={financialYear}
      availableFinancialYears={AVAILABLE_FINANCIAL_YEARS}
      onFinancialYearChange={setFinancialYear}
      estimate={estimate}
      capSummaries={capSummaries}
      helpDebts={helpDebts.helpDebts ?? []}
      helpPayoff={helpPayoff}
      deductions={deductionRows}
      payslipCounts={payslipCountByMember(payslipRows)}
      receipts={receiptRows}
      signedUrl={receipts.signedUrl}
    />
  )
}
