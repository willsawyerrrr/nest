import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionRow } from '../hooks/useDeductions'

/** The `id` of the droppable that clears a deduction's group. */
export const UNGROUPED_DROP_ID = 'ungrouped'

/** The `id` of the droppable for a group. */
export const groupDropId = (groupId: string) => `group:${groupId}`

/**
 * The `group_id` a deduction takes when dropped on `dropId`: a group's id, `null`
 * for the ungrouped list, or `undefined` when the drop is not a valid move —
 * onto a group of another member or financial year (the composite reference
 * would refuse it), or onto where the deduction already sits.
 */
export function droppedGroupId(
  deduction: DeductionRow,
  dropId: string,
  groups: DeductionGroupRow[],
): string | null | undefined {
  if (dropId === UNGROUPED_DROP_ID) {
    return deduction.group_id === null ? undefined : null
  }
  const group = groups.find((candidate) => groupDropId(candidate.id) === dropId)
  if (
    !group ||
    group.id === deduction.group_id ||
    group.member_id !== deduction.member_id ||
    group.financial_year !== deduction.financial_year
  ) {
    return undefined
  }
  return group.id
}
