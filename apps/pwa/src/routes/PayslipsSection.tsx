import { LoadingScreen } from '../components/LoadingScreen'
import { PayslipsScreen } from '../components/PayslipsScreen'
import { useDeductions } from '../hooks/useDeductions'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { usePayslips } from '../hooks/usePayslips'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { currentTaxConfig, estimateHouseholdTaxFromRows } from '../lib/tax'

export function PayslipsSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const payslips = usePayslips(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const contributions = useSuperContributions(householdId)
  const helpDebts = useHelpDebts(householdId)
  const deductions = useDeductions(householdId)

  if (
    membersLoading ||
    inflows.loading ||
    payslips.loading ||
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
      inflows={inflows.inflows ?? []}
      financialYear={payslips.financialYear}
      estimate={estimate}
      config={config}
      onCreate={({ input, file }) => payslips.create(input, file)}
      onUpdate={(id, { input, file }) => payslips.update(id, input, file)}
      onDelete={payslips.remove}
      signedUrl={payslips.signedUrl}
    />
  )
}
