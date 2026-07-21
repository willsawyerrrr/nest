import { useCallback } from 'react'
import { GoalScreen } from '../components/GoalScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useGoals } from '../hooks/useGoals'
import { useRefreshSavers } from '../hooks/useRefreshSavers'
import { useSavers } from '../hooks/useSavers'

export function GoalsSection({ householdId }: { householdId: string }) {
  const goals = useGoals(householdId)
  const budgetLines = useBudgetLines(householdId)
  const savers = useSavers()

  // Refreshing pulls fresh Up balances, so both the savers and the goals that
  // read from them are reloaded.
  const reloadSavers = savers.reload
  const reloadGoals = goals.reload
  const reloadBalances = useCallback(async () => {
    await Promise.all([reloadSavers(), reloadGoals()])
  }, [reloadSavers, reloadGoals])
  const refresh = useRefreshSavers(reloadBalances)

  if (goals.loading || budgetLines.loading || savers.loading) {
    return <LoadingScreen />
  }

  return (
    <GoalScreen
      goals={goals.goals ?? []}
      lines={budgetLines.lines ?? []}
      savers={savers.savers ?? []}
      onCreateGoal={goals.create}
      onUpdateGoal={goals.update}
      onDeleteGoal={goals.remove}
      onRefresh={() => void refresh.refresh()}
      refreshing={refresh.refreshing}
      refreshError={refresh.error}
    />
  )
}
