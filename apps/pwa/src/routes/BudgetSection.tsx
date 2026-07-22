import { useMemo } from 'react'
import { BudgetScreen } from '../components/BudgetScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useAccountDirectory } from '../hooks/useAccountDirectory'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useDerivedLineEditor } from '../hooks/useDerivedLineEditor'
import { useGifts } from '../hooks/useGifts'
import { useGoals } from '../hooks/useGoals'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { breakdownAnnualTotals } from '../lib/breakdowns'
import { applyBreakdownAmounts } from '../lib/derivedBudget'
import { giftBudgetTotalCents } from '../lib/gifts'
import { superAccountIds } from '../lib/super'

export function BudgetSection({ householdId }: { householdId: string }) {
  const budgetLines = useBudgetLines(householdId)
  const temporaryItems = useTemporaryItems(householdId)
  const goals = useGoals(householdId)
  const gifts = useGifts(householdId)
  const breakdowns = useBreakdowns(householdId)
  const accounts = useAccountDirectory()
  const superProfiles = useSuperProfiles(householdId)

  const giftBudgets = useMemo(() => gifts.budgets ?? [], [gifts.budgets])
  const breakdownRows = useMemo(() => breakdowns.breakdowns ?? [], [breakdowns.breakdowns])
  const breakdownItems = useMemo(() => breakdowns.items ?? [], [breakdowns.items])
  const totals = useMemo(
    () => breakdownAnnualTotals(breakdownRows, breakdownItems, giftBudgetTotalCents(giftBudgets)),
    [breakdownRows, breakdownItems, giftBudgets],
  )

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
