import { useMemo, useState } from 'react'
import { payCycleAnchor, spendFortnight } from '@nest/plan'
import { ActualSpendBar } from '../components/ActualSpendBar'
import { BudgetScreen } from '../components/BudgetScreen'
import { CategoryGroupsModal } from '../components/CategoryGroupsModal'
import { LoadingScreen } from '../components/LoadingScreen'
import { usePlanningMode } from '../components/PlanningModeProvider'
import { useAccountDirectory } from '../hooks/useAccountDirectory'
import { useActualSpend } from '../hooks/useActualSpend'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useCategoryGroups } from '../hooks/useCategoryGroups'
import { useCurrentMember } from '../hooks/useCurrentMember'
import { useDerivedLineEditor } from '../hooks/useDerivedLineEditor'
import { useGifts } from '../hooks/useGifts'
import { useGoals } from '../hooks/useGoals'
import { useInflows } from '../hooks/useInflows'
import { useMemberAllowances } from '../hooks/useMemberAllowances'
import { useMembers } from '../hooks/useMembers'
import { useNow } from '../hooks/useNow'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { derivedAmountContext } from '../lib/breakdowns'
import { todayIso } from '../lib/dates'
import { applyBreakdownAmounts } from '../lib/derivedBudget'
import { takeBudgetDraft } from '../lib/promoteDraft'
import { superAccountIds } from '../lib/super'

export function BudgetSection() {
  const budgetLines = useBudgetLines()
  const temporaryItems = useTemporaryItems()
  const goals = useGoals()
  const gifts = useGifts()
  const breakdowns = useBreakdowns()
  const accounts = useAccountDirectory()
  const superProfiles = useSuperProfiles()
  const members = useMembers()
  const currentMember = useCurrentMember()
  const memberAllowances = useMemberAllowances()
  // A wishlist item promoted from the Wishlist tab, picked up once on mount.
  const [promoteDraft, setPromoteDraft] = useState(takeBudgetDraft)

  // Actual spend: the fortnight on the household's pay cycle holding today,
  // stepped back `fortnightOffset` fortnights. Planning mode never moves the
  // pay cycle, so the anchor reads the real inflows.
  const inflows = useInflows()
  const today = todayIso(useNow())
  const [fortnightOffset, setFortnightOffset] = useState(0)
  const [includePending, setIncludePending] = useState(false)
  const period = spendFortnight(
    payCycleAnchor(inflows.baselineInflows ?? []),
    today,
    fortnightOffset,
  )
  const actualSpend = useActualSpend(period, includePending)
  const categoryGroups = useCategoryGroups()
  const [editingCategoryGroups, setEditingCategoryGroups] = useState(false)

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
    superProfiles.loading ||
    members.loading ||
    memberAllowances.loading ||
    currentMember.loading ||
    inflows.loading
  ) {
    return <LoadingScreen />
  }

  // Super-fund balance accounts are not spendable, so they cannot fund a line.
  const superIds = superAccountIds(superProfiles.profiles ?? [])
  return (
    <>
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
        members={members.members ?? []}
        allowances={memberAllowances.allowances ?? []}
        currentMemberId={currentMember.member?.id ?? null}
        onUpdateAllowance={memberAllowances.update}
        onCreateLine={budgetLines.create}
        onUpdateLine={budgetLines.update}
        onUpdateDerivedLine={planning ? undefined : handleUpdateDerivedLine}
        onDeleteLine={budgetLines.remove}
        onCreateItem={temporaryItems.create}
        onUpdateItem={temporaryItems.update}
        onDeleteItem={temporaryItems.remove}
        promoteDraft={promoteDraft}
        onPromoteConsumed={() => setPromoteDraft(null)}
        actualSpendBar={
          <ActualSpendBar
            period={period}
            isCurrent={fortnightOffset === 0}
            onPrevious={() => setFortnightOffset((offset) => offset - 1)}
            onNext={() => setFortnightOffset((offset) => Math.min(0, offset + 1))}
            includePending={includePending}
            onIncludePendingChange={setIncludePending}
            unbudgetedCents={actualSpend?.unbudgeted ?? null}
            onEditCategoryGroups={() => setEditingCategoryGroups(true)}
          />
        }
        actualByGroup={actualSpend?.groups}
      />
      <CategoryGroupsModal
        opened={editingCategoryGroups}
        onClose={() => setEditingCategoryGroups(false)}
        categories={categoryGroups.categories}
        onSetGroup={categoryGroups.setGroup}
        onResetGroup={categoryGroups.resetGroup}
      />
    </>
  )
}
