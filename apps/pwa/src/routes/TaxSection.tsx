import { LoadingScreen } from '../components/LoadingScreen'
import { TaxEstimateView } from '../components/TaxEstimateView'
import { useDeductions } from '../hooks/useDeductions'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { usePayslips } from '../hooks/usePayslips'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { memberName } from '../lib/members'
import { paygWithheldFromRows } from '../lib/payslips'
import {
  currentTaxConfig,
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  superCapSummaryFromRows,
} from '../lib/tax'

export function TaxSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const contributions = useSuperContributions(householdId)
  const superProfiles = useSuperProfiles(householdId)
  const helpDebts = useHelpDebts(householdId)
  const deductions = useDeductions(householdId)
  const payslips = usePayslips(householdId)

  if (
    membersLoading ||
    inflows.loading ||
    taxProfiles.loading ||
    contributions.loading ||
    superProfiles.loading ||
    helpDebts.loading ||
    deductions.loading ||
    payslips.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const config = currentTaxConfig()
  // Actual withholding from this year's payslips nets against each member's
  // estimated liability, turning it into a refund or an amount owing. With no
  // payslips the map is empty and every figure is the bare estimate.
  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
    helpDebts.helpDebts ?? [],
    deductions.deductions ?? [],
    config,
    paygWithheldFromRows(payslips.payslips ?? []),
  )
  const capSummaries = superCapSummaryFromRows(
    inflows.inflows ?? [],
    superProfiles.profiles ?? [],
    contributions.contributions ?? [],
  )
  const concessionalCapCentsByMember = new Map(
    [...capSummaries].map(([memberId, summary]) => [memberId, summary.concessionalCapCents]),
  )
  const helpPayoff = helpPayoffByMember(estimate, helpDebts.helpDebts ?? [])

  return (
    <TaxEstimateView
      estimate={estimate}
      financialYear={taxProfiles.financialYear}
      memberName={(id) => memberName(members, id)}
      config={config}
      concessionalCapCentsByMember={concessionalCapCentsByMember}
      helpPayoff={helpPayoff}
    />
  )
}
