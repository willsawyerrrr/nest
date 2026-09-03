import { useMemo, useState } from 'react'
import { BudgetScreen } from '../components/BudgetScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { usePlanningMode } from '../components/PlanningModeProvider'
import { useAccountDirectory } from '../hooks/useAccountDirectory'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useDerivedLineEditor } from '../hooks/useDerivedLineEditor'
import { useGifts } from '../hooks/useGifts'
import { useGoals } from '../hooks/useGoals'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { derivedAmountContext } from '../lib/breakdowns'
import { applyBreakdownAmounts } from '../lib/derivedBudget'
import { takeBudgetDraft } from '../lib/promoteDraft'
import { superAccountIds } from '../lib/super'

export function BudgetSection({ householdId }: { householdId: string }) {
  const budgetLines = useBudgetLines(householdId)
  const temporaryItems = useTemporaryItems(householdId)
  const goals = useGoals(householdId)
  const gifts = useGifts(householdId)
  const breakdowns = useBreakdowns(householdId)
  const accounts = useAccountDirectory()
  const superProfiles = useSuperProfiles(householdId)
  // A wishlist item promoted from the Wishlist tab, picked up once on mount.
  const [promoteDraft, setPromoteDraft] = useState(takeBudgetDraft)

  const giftBudgets = useMemo(() => gifts.budgets ?? [], [gifts.budgets])
  const giftRecipients = useMemo(() => gifts.recipients ?? [], [gifts.recipients])
  const giftDiscretionaryBudget = gifts.discretionaryBudget
  const breakdownRows = useMemo(() => breakdowns.breakdowns ?? [], [breakdowns.breakdowns])
  const breakdownItems = useMemo(() => breakdowns.items ?? [], [breakdowns.items])
  const context = useMemo(
    () =>
      derivedAmountContext(
        breakdownRows,
        breakdownItems,
        giftBudgets,
        giftRecipients,
        giftDiscretionaryBudget,
      ),
    [breakdownRows, breakdownItems, giftBudgets, giftRecipients, giftDiscretionaryBudget],
  )

  const handleUpdateDerivedLine = useDerivedLineEditor({
    lines: budgetLines.lines,
    updateBreakdown: breakdowns.update,
    updateLine: budgetLines.update,
  })

  // A derived line's edit writes its breakdown or gift row — real data the
  // sandbox does not cover, and which cannot reflow without the DB trigger. In
  // planning mode those lines are read-only; only manual lines stay editable.
  const { active: planning } = usePlanningMode()

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
      lines={applyBreakdownAmounts(budgetLines.lines ?? [], context)}
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
      onUpdateDerivedLine={planning ? undefined : handleUpdateDerivedLine}
      onDeleteLine={budgetLines.remove}
      onCreateItem={temporaryItems.create}
      onUpdateItem={temporaryItems.update}
      onDeleteItem={temporaryItems.remove}
      promoteDraft={promoteDraft}
      onPromoteConsumed={() => setPromoteDraft(null)}
    />
  )
}
