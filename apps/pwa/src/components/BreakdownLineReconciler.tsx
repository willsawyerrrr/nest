import { useMemo } from 'react'
import { useAccountDirectory } from '../hooks/useAccountDirectory'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useGifts } from '../hooks/useGifts'
import { useMembers } from '../hooks/useMembers'
import { useReconcileBreakdownLines } from '../hooks/useReconcileBreakdownLines'
import { breakdownItemCounts, derivedAmountContext } from '../lib/breakdowns'

/**
 * Runs the derived-line reconcile for the whole session, independent of the
 * active route. Mounted under the authenticated shell so a breakdown edit made
 * anywhere rewrites the owned budget lines, keeping the Budget and Pay splits tabs
 * in step without a reload. Renders nothing.
 */
export function BreakdownLineReconciler({ householdId }: { householdId: string }) {
  const budgetLines = useBudgetLines(householdId)
  const breakdowns = useBreakdowns(householdId)
  const gifts = useGifts(householdId)
  const members = useMembers()
  const directory = useAccountDirectory()

  const giftBudgets = useMemo(() => gifts.budgets ?? [], [gifts.budgets])
  const giftRecipients = useMemo(() => gifts.recipients ?? [], [gifts.recipients])
  const breakdownRows = useMemo(() => breakdowns.breakdowns ?? [], [breakdowns.breakdowns])
  const breakdownItems = useMemo(() => breakdowns.items ?? [], [breakdowns.items])
  const context = useMemo(
    () => derivedAmountContext(breakdownRows, breakdownItems, giftBudgets, giftRecipients),
    [breakdownRows, breakdownItems, giftBudgets, giftRecipients],
  )
  const counts = useMemo(
    () => breakdownItemCounts(breakdownRows, breakdownItems),
    [breakdownRows, breakdownItems],
  )
  const memberNames = useMemo(
    () => new Map((members.members ?? []).map((member) => [member.id, member.name])),
    [members.members],
  )
  const memberList = useMemo(() => members.members ?? [], [members.members])
  const directoryEntries = useMemo(() => directory.accounts ?? [], [directory.accounts])

  useReconcileBreakdownLines({
    lines: budgetLines.lines,
    dataLoaded:
      !budgetLines.loading &&
      !breakdowns.loading &&
      !gifts.loading &&
      !members.loading &&
      !directory.loading,
    breakdowns: breakdownRows,
    context,
    counts,
    memberNames,
    members: memberList,
    directory: directoryEntries,
    createLine: budgetLines.create,
    updateLine: budgetLines.update,
    removeLine: budgetLines.remove,
  })

  return null
}
