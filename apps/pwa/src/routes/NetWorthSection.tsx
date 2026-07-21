import { LoadingScreen } from '../components/LoadingScreen'
import { NetWorthView } from '../components/NetWorthView'
import { useAccounts } from '../hooks/useAccounts'
import { useInflows } from '../hooks/useInflows'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { accountsWithEffectiveSuperBalances, superAccountIds } from '../lib/super'
import { netAnnualSuperContributionFromRows } from '../lib/tax'

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
      onToggleExclude={(id, exclude) => {
        void accounts.update(id, { exclude_from_net_worth: exclude })
      }}
    />
  )
}
