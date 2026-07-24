import { describe, expect, it } from 'vitest'
import {
  inflowTypeLabel,
  NON_TAXABLE_INFLOW_TYPE_OPTIONS,
  TAXABLE_INFLOW_TYPE_OPTIONS,
} from './inflowTypes'

describe('inflowTypeLabel', () => {
  it('labels each inflow type', () => {
    expect(inflowTypeLabel('salary')).toBe('Salary')
    expect(inflowTypeLabel('wage')).toBe('Wage')
    expect(inflowTypeLabel('other')).toBe('Other')
    expect(inflowTypeLabel('reimbursement')).toBe('Reimbursement')
    expect(inflowTypeLabel('hobby')).toBe('Hobby income')
    expect(inflowTypeLabel('gift')).toBe('Gift')
  })
})

describe('inflow type options', () => {
  it('lists the taxable types in display order', () => {
    expect(TAXABLE_INFLOW_TYPE_OPTIONS).toEqual([
      { value: 'salary', label: 'Salary' },
      { value: 'wage', label: 'Wage' },
      { value: 'other', label: 'Other' },
    ])
  })

  it('lists the non-taxable types in display order', () => {
    expect(NON_TAXABLE_INFLOW_TYPE_OPTIONS).toEqual([
      { value: 'reimbursement', label: 'Reimbursement' },
      { value: 'hobby', label: 'Hobby income' },
      { value: 'gift', label: 'Gift' },
      { value: 'other', label: 'Other' },
    ])
  })
})
