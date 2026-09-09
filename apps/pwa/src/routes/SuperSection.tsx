import { LoadingScreen } from '../components/LoadingScreen'
import { SuperScreen } from '../components/SuperScreen'
import { useAccounts } from '../hooks/useAccounts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { useSaveSuperProfile } from '../hooks/useSaveSuperProfile'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import {
  currentTaxConfig,
  netAnnualSuperContributionFromRows,
  superCapSummaryFromRows,
} from '../lib/tax'

export function SuperSection() {
  const { members, loading: membersLoading } = useMembers()
  const superProfiles = useSuperProfiles()
  const accounts = useAccounts()
  const contributions = useSuperContributions()
  const inflows = useInflows()

  const profileRows = superProfiles.profiles

  const onSave = useSaveSuperProfile({
    profiles: profileRows,
    insertAccount: accounts.insert,
    updateAccount: accounts.update,
    upsertBalance: accounts.upsertBalance,
    upsertProfile: superProfiles.upsert,
  })

  if (
    membersLoading ||
    superProfiles.loading ||
    accounts.loading ||
    contributions.loading ||
    inflows.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const capSummaries = superCapSummaryFromRows(
    inflows.inflows ?? [],
    profileRows ?? [],
    contributions.contributions ?? [],
  )
  const netContributionByMember = netAnnualSuperContributionFromRows(
    inflows.inflows ?? [],
    contributions.contributions ?? [],
  )

  return (
    <SuperScreen
      members={members}
      profiles={profileRows ?? []}
      accounts={accounts.accounts ?? []}
      contributions={contributions.contributions ?? []}
      capSummaries={capSummaries}
      netContributionByMember={netContributionByMember}
      preservationAge={currentTaxConfig().super.preservationAge}
      financialYear={superProfiles.financialYear}
      onSave={onSave}
      onCreateContribution={contributions.create}
      onUpdateContribution={contributions.update}
      onDeleteContribution={contributions.remove}
    />
  )
}
