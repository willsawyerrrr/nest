import { describe, expect, it } from 'vitest'
import type { DeductionGroupRow } from '../hooks/useDeductionGroups'
import type { DeductionRow } from '../hooks/useDeductions'
import { groupDeductions } from './deductionGroups'

const group = (id: string): DeductionGroupRow => ({ id, name: id }) as DeductionGroupRow
const deduction = (id: string, group_id: string | null, amount_cents: number): DeductionRow =>
  ({ id, group_id, amount_cents }) as DeductionRow

describe('groupDeductions', () => {
  it('files payments under their group, summing each total, and leaves the rest ungrouped', () => {
    const result = groupDeductions(
      [group('g1'), group('g2')],
      [deduction('a', 'g1', 10_00), deduction('b', 'g1', 5_00), deduction('c', null, 7_00)],
    )
    expect(result.groups.map((entry) => [entry.group.id, entry.totalCents])).toEqual([
      ['g1', 15_00],
      ['g2', 0],
    ])
    expect(result.groups[0]!.payments.map((payment) => payment.id)).toEqual(['a', 'b'])
    expect(result.groups[1]!.payments).toEqual([])
    expect(result.ungrouped.map((payment) => payment.id)).toEqual(['c'])
  })

  it('has no groups when the member has none', () => {
    const result = groupDeductions([], [deduction('a', null, 1_00)])
    expect(result.groups).toEqual([])
    expect(result.ungrouped).toHaveLength(1)
  })
})
