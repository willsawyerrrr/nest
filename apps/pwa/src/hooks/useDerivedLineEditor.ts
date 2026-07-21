import { useCallback } from 'react'
import type { DerivedLineValues } from '../components/DerivedBudgetLineForm'
import type { UseBreakdownsResult } from './useBreakdowns'
import type { BudgetLine, UseBudgetLinesResult } from './useBudgetLines'

interface UseDerivedLineEditorParams {
  /** The household's budget lines, or `null` while loading. */
  lines: BudgetLine[] | null
  updateBreakdown: UseBreakdownsResult['update']
  updateLine: UseBudgetLinesResult['update']
}

/**
 * Composes the budget-line and breakdown collections into a single derived-line
 * save. Editing a derived line fans out: its name and group belong to the owning
 * breakdown (reconcile copies them back onto the line), its funding account to
 * the line itself. The amount stays owned by the breakdown's items.
 */
export function useDerivedLineEditor({
  lines,
  updateBreakdown,
  updateLine,
}: UseDerivedLineEditorParams): (lineId: string, values: DerivedLineValues) => Promise<void> {
  return useCallback(
    async (lineId: string, values: DerivedLineValues) => {
      const line = (lines ?? []).find((candidate) => candidate.id === lineId)
      if (!line?.breakdown_id) {
        return
      }
      await updateBreakdown(line.breakdown_id, {
        name: values.name,
        line_group: values.line_group,
      })
      await updateLine(lineId, {
        line_group: values.line_group,
        name: values.name,
        amount_cents: line.amount_cents,
        frequency: line.frequency,
        interval_count: line.interval_count,
        goal_id: line.goal_id,
        breakdown_id: line.breakdown_id,
        destination_account_id: values.destination_account_id,
      })
    },
    [lines, updateBreakdown, updateLine],
  )
}
