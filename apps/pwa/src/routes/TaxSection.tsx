import { LoadingScreen } from '../components/LoadingScreen'
import { TaxEstimateView } from '../components/TaxEstimateView'
import { useDeductions } from '../hooks/useDeductions'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { memberName } from '../lib/members'
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

  if (
    membersLoading ||
    inflows.loading ||
    taxProfiles.loading ||
    contributions.loading ||
    superProfiles.loading ||
    helpDebts.loading ||
    deductions.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
    helpDebts.helpDebts ?? [],
    deductions.deductions ?? [],
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
      config={currentTaxConfig()}
      concessionalCapCentsByMember={concessionalCapCentsByMember}
      helpPayoff={helpPayoff}
    />
  )
}
