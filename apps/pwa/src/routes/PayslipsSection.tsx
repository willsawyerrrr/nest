import { LoadingScreen } from '../components/LoadingScreen'
import { PayslipsScreen } from '../components/PayslipsScreen'
import { useDeductions } from '../hooks/useDeductions'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { usePayslipLines } from '../hooks/usePayslipLines'
import { usePayslips } from '../hooks/usePayslips'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { currentTaxConfig, estimateHouseholdTaxFromRows } from '../lib/tax'

export function PayslipsSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const payslips = usePayslips(householdId)
  const payslipLines = usePayslipLines(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const contributions = useSuperContributions(householdId)
  const helpDebts = useHelpDebts(householdId)
  const deductions = useDeductions(householdId)

  if (
    membersLoading ||
    inflows.loading ||
    payslips.loading ||
    payslipLines.loading ||
    taxProfiles.loading ||
    contributions.loading ||
    helpDebts.loading ||
    deductions.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  // The estimate supplies each member's annual tax and concessional super, which
  // the per-period withholding and super expectations are prorated from.
  const config = currentTaxConfig()
  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
    helpDebts.helpDebts ?? [],
    deductions.deductions ?? [],
    config,
  )

  return (
    <PayslipsScreen
      members={members}
      payslips={payslips.payslips ?? []}
      lines={payslipLines.lines ?? []}
      inflows={inflows.inflows ?? []}
      financialYear={payslips.financialYear}
      estimate={estimate}
      config={config}
      attachments={payslips.attachments}
      // A slip and its lines go in one transaction, under the id the submission
      // carries, so adding a slip and editing one take the very same path.
      onCreate={payslips.save}
      onUpdate={(_id, submission) => payslips.save(submission)}
      onDelete={payslips.remove}
      signedUrl={payslips.signedUrl}
    />
  )
}
