import { LoadingScreen } from '../components/LoadingScreen'
import { SplitsScreen } from '../components/SplitsScreen'
import { useAccounts } from '../hooks/useAccounts'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useGoals } from '../hooks/useGoals'
import { usePaySplits } from '../hooks/usePaySplits'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { superAccountIds } from '../lib/super'

export function SplitsSection({ householdId }: { householdId: string }) {
  const budgetLines = useBudgetLines(householdId)
  const goals = useGoals(householdId)
  const accounts = useAccounts(householdId)
  const superProfiles = useSuperProfiles(householdId)
  const paySplits = usePaySplits(householdId)

  if (
    budgetLines.loading ||
    goals.loading ||
    accounts.loading ||
    superProfiles.loading ||
    paySplits.loading
  ) {
    return <LoadingScreen />
  }

  // Super-fund balance accounts are not spendable, so they are never split targets.
  const superIds = superAccountIds(superProfiles.profiles ?? [])
  return (
    <SplitsScreen
      accounts={(accounts.accounts ?? []).filter((account) => !superIds.has(account.id))}
      lines={budgetLines.lines ?? []}
      goals={goals.goals ?? []}
      configuredByAccount={paySplits.configuredByAccount}
      onConfirm={(id, cents) => void paySplits.confirm(id, cents)}
    />
  )
}
