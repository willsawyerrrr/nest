import { useMembers } from '../hooks/useMembers'
import { useInflows } from '../hooks/useInflows'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { TaxEstimateView } from '../components/TaxEstimateView'
import { LoadingScreen } from '../components/LoadingScreen'
import { estimateHouseholdTaxFromRows } from '../lib/tax'

export function TaxSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const contributions = useSuperContributions(householdId)

  if (
    membersLoading ||
    inflows.loading ||
    taxProfiles.loading ||
    contributions.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
  )
  const memberName = (id: string) => members.find((member) => member.id === id)?.name ?? 'Unknown'

  return (
    <TaxEstimateView
      estimate={estimate}
      financialYear={taxProfiles.financialYear}
      memberName={memberName}
    />
  )
}
