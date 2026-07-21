import { useAccounts } from '../hooks/useAccounts'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useInflows } from '../hooks/useInflows'
import { NetWorthView } from '../components/NetWorthView'
import { LoadingScreen } from '../components/LoadingScreen'
import { netAnnualSuperContributionFromRows } from '../lib/tax'
import { accountsWithEffectiveSuperBalances, superAccountIds } from '../lib/super'

export function NetWorthSection({ householdId }: { householdId: string }) {
  const accounts = useAccounts(householdId)
  const superProfiles = useSuperProfiles(householdId)
  const contributions = useSuperContributions(householdId)
  const inflows = useInflows(householdId)

  if (accounts.loading || superProfiles.loading || contributions.loading || inflows.loading) {
    return <LoadingScreen />
  }

  const profileRows = superProfiles.profiles ?? []
  const netContributionByMember = netAnnualSuperContributionFromRows(
    inflows.inflows ?? [],
    contributions.contributions ?? [],
  )

  return (
    <NetWorthView
      accounts={accountsWithEffectiveSuperBalances(
        accounts.accounts ?? [],
        profileRows,
        netContributionByMember,
        new Date(),
      )}
      superIds={superAccountIds(profileRows)}
    />
  )
}
