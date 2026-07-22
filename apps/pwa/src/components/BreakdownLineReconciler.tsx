import { useMemo } from 'react'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useGifts } from '../hooks/useGifts'
import { useReconcileBreakdownLines } from '../hooks/useReconcileBreakdownLines'
import { breakdownAnnualTotals, breakdownItemCounts } from '../lib/breakdowns'
import { giftBudgetTotalCents } from '../lib/gifts'

/**
 * Runs the derived-line reconcile for the whole session, independent of the
 * active route. Mounted under the authenticated shell so a breakdown edit made
 * anywhere rewrites the owned budget line, keeping the Budget and Pay splits tabs
 * in step without a reload. Renders nothing.
 */
export function BreakdownLineReconciler({ householdId }: { householdId: string }) {
  const budgetLines = useBudgetLines(householdId)
  const breakdowns = useBreakdowns(householdId)
  const gifts = useGifts(householdId)

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

  return null
}
