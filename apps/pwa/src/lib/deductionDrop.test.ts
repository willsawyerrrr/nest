import { describe, expect, it } from 'vitest'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionRow } from '../hooks/useDeductions'
import { droppedGroupId, groupDropId, UNGROUPED_DROP_ID } from './deductionDrop'

const deduction = (overrides: Partial<DeductionRow> = {}) =>
  ({ member_id: 'm1', financial_year: 2027, group_id: null, ...overrides }) as DeductionRow

const group = (overrides: Partial<DeductionGroupRow> = {}) =>
  ({ id: 'g1', member_id: 'm1', financial_year: 2027, ...overrides }) as DeductionGroupRow

describe('droppedGroupId', () => {
  it('files into a group of the same member and year', () => {
    expect(droppedGroupId(deduction(), groupDropId('g1'), [group()])).toBe('g1')
  })

  it('clears the group on the ungrouped list, but not for an ungrouped deduction', () => {
    expect(droppedGroupId(deduction({ group_id: 'g1' }), UNGROUPED_DROP_ID, [])).toBeNull()
    expect(droppedGroupId(deduction(), UNGROUPED_DROP_ID, [])).toBeUndefined()
  })

  it('refuses an unknown group, its own group, and another member or year', () => {
    const drop = groupDropId('g1')
    expect(droppedGroupId(deduction(), 'group:missing', [group()])).toBeUndefined()
    expect(droppedGroupId(deduction({ group_id: 'g1' }), drop, [group()])).toBeUndefined()
    expect(droppedGroupId(deduction(), drop, [group({ member_id: 'm2' })])).toBeUndefined()
    expect(droppedGroupId(deduction(), drop, [group({ financial_year: 2026 })])).toBeUndefined()
  })
})
