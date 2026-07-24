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
 * Composes a single derived-line save. Editing a generic breakdown line fans out:
 * its name and group belong to the owning breakdown (reconcile copies them back
 * onto the line), its funding account to the line itself. A gift line
 * (`is_gift_line`) has a partition-derived name ("Gifts for <member>") and a
 * per-line group, so its save touches only the line, never a breakdown: the edited
 * group is written straight onto the line (each gift line's group is independent)
 * and its name and recipient partition stay untouched. A gift member line's funding
 * account is auto-derived (the buyer's spending account) and stays reconcile-owned,
 * so the save leaves it at its current value; every other line's funding account is
 * set from the edit. The amount stays roll-up-owned in every case.
 */
export function useDerivedLineEditor({
  lines,
  updateBreakdown,
  updateLine,
}: UseDerivedLineEditorParams): (lineId: string, values: DerivedLineValues) => Promise<void> {
  return useCallback(
    async (lineId: string, values: DerivedLineValues) => {
      const line = (lines ?? []).find((candidate) => candidate.id === lineId)
      // A derived line is a gift line or a generic breakdown line; a plain manual
      // line has neither and is edited through the manual form instead.
      if (!line || (!line.is_gift_line && !line.breakdown_id)) {
        return
      }
      // A gift member line's funding account is auto-derived, so the edit never
      // sets it — the line keeps its reconcile-owned value.
      const fundingLocked = line.gift_recipient_member_id !== null
      // A gift line owns its own name and group, so only the line is written; a
      // generic line's name and group belong to the breakdown.
      if (!line.is_gift_line && line.breakdown_id) {
        await updateBreakdown(line.breakdown_id, {
          name: values.name,
          line_group: values.line_group,
        })
      }
      await updateLine(lineId, {
        line_group: values.line_group,
        name: line.is_gift_line ? line.name : values.name,
        amount_cents: line.amount_cents,
        frequency: line.frequency,
        interval_count: line.interval_count,
        goal_id: line.goal_id,
        breakdown_id: line.breakdown_id,
        destination_account_id: fundingLocked
          ? line.destination_account_id
          : values.destination_account_id,
        gift_recipient_member_id: line.gift_recipient_member_id,
        is_gift_line: line.is_gift_line,
      })
    },
    [lines, updateBreakdown, updateLine],
  )
}
