import { describe, expect, it } from 'vitest'
import {
  inflowTypeLabel,
  NON_TAXABLE_INFLOW_TYPE_OPTIONS,
  ONE_OFF_TAX_TREATMENT_OPTIONS,
  oneOffTaxTreatmentLabel,
  TAXABLE_INFLOW_TYPE_OPTIONS,
  TAXABLE_ONE_OFF_TYPE_OPTIONS,
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

describe('one-off tax treatments', () => {
  it('labels each treatment by the concession it names', () => {
    expect(oneOffTaxTreatmentLabel('ordinary')).toBe('Ordinary income')
    expect(oneOffTaxTreatmentLabel('genuine_redundancy')).toBe('Genuine redundancy')
    expect(oneOffTaxTreatmentLabel('employment_termination')).toBe('Employment termination payment')
    expect(oneOffTaxTreatmentLabel('unused_leave')).toBe('Unused leave on redundancy')
  })

  it('lists the treatment options in display order', () => {
    expect(ONE_OFF_TAX_TREATMENT_OPTIONS.map((option) => option.value)).toEqual([
      'ordinary',
      'genuine_redundancy',
      'employment_termination',
      'unused_leave',
    ])
  })

  it('offers a one-off every taxable type but wage, which prices hours', () => {
    expect(TAXABLE_ONE_OFF_TYPE_OPTIONS).toEqual([
      { value: 'salary', label: 'Salary' },
      { value: 'other', label: 'Other' },
    ])
  })
})
