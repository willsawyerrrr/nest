import { useCallback, useState } from 'react'
import { GoalScreen } from '../components/GoalScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { usePlanningMode } from '../components/PlanningModeProvider'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useGoals } from '../hooks/useGoals'
import { useSavers } from '../hooks/useSavers'
import { useUpSync } from '../hooks/useUpSync'
import { takeGoalDraft } from '../lib/promoteDraft'

export function GoalsSection() {
  const { active: planning } = usePlanningMode()
  // A wishlist item promoted from the Wishlist tab, picked up once on mount.
  const [promoteDraft, setPromoteDraft] = useState(takeGoalDraft)
  const goals = useGoals()
  const budgetLines = useBudgetLines()
  const savers = useSavers()

  // Refreshing pulls fresh Up balances, so the savers and the goals that read
  // from them are reloaded. The sync also rewrites synced accounts, which drives
  // the `budget_line` reconcile trigger to re-derive gift-line buyer funding, so
  // the budget lines are reloaded too.
  const reloadSavers = savers.reload
  const reloadGoals = goals.reload
  const reloadLines = budgetLines.reload
  const reloadBalances = useCallback(async () => {
    await Promise.all([reloadSavers(), reloadGoals(), reloadLines()])
  }, [reloadSavers, reloadGoals, reloadLines])
  const refresh = useUpSync(reloadBalances)

  if (goals.loading || budgetLines.loading || savers.loading) {
    return <LoadingScreen />
  }

  return (
    <GoalScreen
      goals={goals.goals ?? []}
      lines={budgetLines.lines ?? []}
      savers={savers.savers ?? []}
      {...(planning && {
        baselineGoals: goals.baselineGoals ?? [],
        baselineLines: budgetLines.baselineLines ?? [],
      })}
      onCreateGoal={goals.create}
      onUpdateGoal={goals.update}
      onDeleteGoal={goals.remove}
      onReorderQueue={goals.reorderQueue}
      onRefresh={() => void refresh.refresh()}
      refreshing={refresh.refreshing}
      refreshError={refresh.error}
      promoteDraft={promoteDraft}
      onPromoteConsumed={() => setPromoteDraft(null)}
    />
  )
}
