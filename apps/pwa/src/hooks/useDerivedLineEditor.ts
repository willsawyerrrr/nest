import { useCallback } from 'react'
import type { DerivedLineValues } from '../components/DerivedBudgetLineForm'
import type { Breakdown, UseBreakdownsResult } from './useBreakdowns'
import type { BudgetLine, UseBudgetLinesResult } from './useBudgetLines'

interface UseDerivedLineEditorParams {
  /** The household's budget lines, or `null` while loading. */
  lines: BudgetLine[] | null
  /** The household's breakdowns, so the save knows whether a line's name is partition-derived. */
  breakdowns: Breakdown[]
  updateBreakdown: UseBreakdownsResult['update']
  updateLine: UseBudgetLinesResult['update']
}

/**
 * Composes the budget-line and breakdown collections into a single derived-line
 * save. Editing a generic derived line fans out: its name and group belong to the
 * owning breakdown (reconcile copies them back onto the line), its funding account
 * to the line itself. A gift-breakdown line's name is partition-derived
 * ("Gifts for <member>"), so only its group flows to the breakdown while its name
 * and recipient partition stay untouched; its funding account is set on the line.
 * The amount stays owned by the breakdown in every case.
 */
export function useDerivedLineEditor({
  lines,
  breakdowns,
  updateBreakdown,
  updateLine,
}: UseDerivedLineEditorParams): (lineId: string, values: DerivedLineValues) => Promise<void> {
  return useCallback(
    async (lineId: string, values: DerivedLineValues) => {
      const line = (lines ?? []).find((candidate) => candidate.id === lineId)
      if (!line?.breakdown_id) {
        return
      }
      const breakdown = breakdowns.find((candidate) => candidate.id === line.breakdown_id)
      const isGift = breakdown?.kind === 'gift'
      await updateBreakdown(line.breakdown_id, {
        // A gift line's name is partition-derived, so leave the breakdown's name as
        // is; a generic line's name is the breakdown's own name.
        name: isGift ? (breakdown?.name ?? values.name) : values.name,
        line_group: values.line_group,
      })
      await updateLine(lineId, {
        line_group: values.line_group,
        name: isGift ? line.name : values.name,
        amount_cents: line.amount_cents,
        frequency: line.frequency,
        interval_count: line.interval_count,
        goal_id: line.goal_id,
        breakdown_id: line.breakdown_id,
        destination_account_id: values.destination_account_id,
        gift_recipient_member_id: line.gift_recipient_member_id,
      })
    },
    [lines, breakdowns, updateBreakdown, updateLine],
  )
}
