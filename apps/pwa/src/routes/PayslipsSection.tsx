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
      // The slip is written first: its lines hang off it, so they are replaced
      // against the id the save lands under.
      onCreate={async ({ input, lines, attachment }) => {
        const id = await payslips.create(input, attachment)
        await payslipLines.replace(id, lines)
      }}
      onUpdate={async (id, { input, lines, attachment }) => {
        await payslips.update(id, input, attachment)
        await payslipLines.replace(id, lines)
      }}
      onDelete={payslips.remove}
      signedUrl={payslips.signedUrl}
    />
  )
}
