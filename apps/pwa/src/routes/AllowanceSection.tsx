import { Navigate } from 'react-router-dom'
import { AllowanceScreen } from '../components/AllowanceScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useAccountDirectory } from '../hooks/useAccountDirectory'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useCurrentMember } from '../hooks/useCurrentMember'
import { useGoals } from '../hooks/useGoals'
import { useMemberAllowances } from '../hooks/useMemberAllowances'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { superAccountIds } from '../lib/super'

export function AllowanceSection() {
  const budgetLines = useBudgetLines()
  const goals = useGoals()
  const accounts = useAccountDirectory()
  const superProfiles = useSuperProfiles()
  const memberAllowances = useMemberAllowances()
  const currentMember = useCurrentMember()

  if (
    budgetLines.loading ||
    goals.loading ||
    accounts.loading ||
    superProfiles.loading ||
    memberAllowances.loading ||
    currentMember.loading
  ) {
    return <LoadingScreen />
  }

  const member = currentMember.member
  const allowance = (memberAllowances.allowances ?? []).find(
    (candidate) => candidate.member_id === member?.id,
  )
  if (!member || !allowance) {
    return <Navigate to="/budget" replace />
  }

  const superIds = superAccountIds(superProfiles.profiles ?? [])
  return (
    <AllowanceScreen
      memberName={member.name}
      allowance={allowance}
      lines={budgetLines.lines ?? []}
      goals={(goals.goals ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        linkedAccountId: g.linked_account_id,
      }))}
      accounts={(accounts.accounts ?? [])
        .filter((account) => !superIds.has(account.id))
        .map((account) => ({ id: account.id, name: account.name }))}
      onCreate={budgetLines.create}
      onUpdate={budgetLines.update}
      onDelete={budgetLines.remove}
    />
  )
}
