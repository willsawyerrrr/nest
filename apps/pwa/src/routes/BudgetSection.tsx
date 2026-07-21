import { useMemo } from 'react'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { useGoals } from '../hooks/useGoals'
import { useGifts } from '../hooks/useGifts'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useAccounts } from '../hooks/useAccounts'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useReconcileBreakdownLines } from '../hooks/useReconcileBreakdownLines'
import { useDerivedLineEditor } from '../hooks/useDerivedLineEditor'
import { BudgetScreen } from '../components/BudgetScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { superAccountIds } from '../lib/super'
import { giftBudgetTotalCents } from '../lib/gifts'
import { applyBreakdownAmounts } from '../lib/derivedBudget'
import { breakdownAnnualTotals, breakdownItemCounts } from '../lib/breakdowns'

export function BudgetSection({ householdId }: { householdId: string }) {
  const budgetLines = useBudgetLines(householdId)
  const temporaryItems = useTemporaryItems(householdId)
  const goals = useGoals(householdId)
  const gifts = useGifts(householdId)
  const breakdowns = useBreakdowns(householdId)
  const accounts = useAccounts(householdId)
  const superProfiles = useSuperProfiles(householdId)

  const giftBudgets = useMemo(() => gifts.budgets ?? [], [gifts.budgets])
  const breakdownRows = useMemo(() => breakdowns.breakdowns ?? [], [breakdowns.breakdowns])
  const breakdownItems = useMemo(() => breakdowns.items ?? [], [breakdowns.items])
  const totals = useMemo(
    () => breakdownAnnualTotals(breakdownRows, breakdownItems, giftBudgetTotalCents(giftBudgets)),
    [breakdownRows, breakdownItems, giftBudgets],
  )
  const counts = useMemo(
    () => breakdownItemCounts(breakdownRows, breakdownItems, giftBudgets.length),
    [breakdownRows, breakdownItems, giftBudgets.length],
  )

  useReconcileBreakdownLines({
    lines: budgetLines.lines,
    dataLoaded: !budgetLines.loading && !breakdowns.loading && !gifts.loading,
    breakdowns: breakdownRows,
    totals,
    counts,
    createLine: budgetLines.create,
    updateLine: budgetLines.update,
    removeLine: budgetLines.remove,
  })

  const handleUpdateDerivedLine = useDerivedLineEditor({
    lines: budgetLines.lines,
    updateBreakdown: breakdowns.update,
    updateLine: budgetLines.update,
  })

  if (
    budgetLines.loading ||
    temporaryItems.loading ||
    goals.loading ||
    gifts.loading ||
    breakdowns.loading ||
    accounts.loading ||
    superProfiles.loading
  ) {
    return <LoadingScreen />
  }

  // Super-fund balance accounts are not spendable, so they cannot fund a line.
  const superIds = superAccountIds(superProfiles.profiles ?? [])
  return (
    <BudgetScreen
      lines={applyBreakdownAmounts(budgetLines.lines ?? [], totals)}
      goals={(goals.goals ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        linkedAccountId: g.linked_account_id,
      }))}
      accounts={(accounts.accounts ?? [])
        .filter((account) => !superIds.has(account.id))
        .map((account) => ({ id: account.id, name: account.name }))}
      breakdowns={breakdownRows.map((breakdown) => ({
        id: breakdown.id,
        name: breakdown.name,
        line_group: breakdown.line_group,
      }))}
      temporaryItems={temporaryItems.items ?? []}
      onCreateLine={budgetLines.create}
      onUpdateLine={budgetLines.update}
      onUpdateDerivedLine={handleUpdateDerivedLine}
      onDeleteLine={budgetLines.remove}
      onCreateItem={temporaryItems.create}
      onUpdateItem={temporaryItems.update}
      onDeleteItem={temporaryItems.remove}
    />
  )
}
