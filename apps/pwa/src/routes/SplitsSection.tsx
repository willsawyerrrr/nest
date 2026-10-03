import { LoadingScreen } from '../components/LoadingScreen'
import { SplitsScreen } from '../components/SplitsScreen'
import { useAccountDirectory } from '../hooks/useAccountDirectory'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useGoals } from '../hooks/useGoals'
import { useMemberAllowances } from '../hooks/useMemberAllowances'
import { useMembers } from '../hooks/useMembers'
import { usePayAccount } from '../hooks/usePayAccount'
import { usePaySplits } from '../hooks/usePaySplits'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { toAssignableAllowances } from '../lib/allowances'
import { superAccountIds } from '../lib/super'

export function SplitsSection() {
  const budgetLines = useBudgetLines()
  const goals = useGoals()
  const accounts = useAccountDirectory()
  const superProfiles = useSuperProfiles()
  const paySplits = usePaySplits()
  const payAccount = usePayAccount()
  const members = useMembers()
  const memberAllowances = useMemberAllowances()

  if (
    budgetLines.loading ||
    goals.loading ||
    accounts.loading ||
    superProfiles.loading ||
    paySplits.loading ||
    payAccount.loading ||
    members.loading ||
    memberAllowances.loading
  ) {
    return <LoadingScreen />
  }

  // Super-fund balance accounts are not spendable, so they are never split targets.
  const superIds = superAccountIds(superProfiles.profiles ?? [])
  return (
    <SplitsScreen
      accounts={(accounts.accounts ?? []).filter((account) => !superIds.has(account.id))}
      lines={budgetLines.lines ?? []}
      allowances={toAssignableAllowances(memberAllowances.allowances ?? [], members.members ?? [])}
      goals={goals.goals ?? []}
      configuredByAccount={paySplits.configuredByAccount}
      payAccountId={payAccount.payAccountId}
      onSetPayAccount={(id) => void payAccount.setPayAccount(id)}
      onConfirm={(id, cents) => void paySplits.confirm(id, cents)}
      onClear={(id) => void paySplits.clear(id)}
    />
  )
}
