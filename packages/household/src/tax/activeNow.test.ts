import { describe, expect, it } from 'vitest'
import type { InflowRow } from '../rows.ts'
import { activeNowTaxableInflows } from '../tax.ts'

function inflow(overrides: Partial<InflowRow> = {}): InflowRow {
  return {
    member_id: 'm1',
    taxable: true,
    attracts_super: true,
    type: 'salary',
    schedule: 'every_n_weeks',
    interval_count: 4,
    paid_on: null,
    one_off_tax_treatment: null,
    years_of_service: null,
    is_joint: false,
    member_split_percent: null,
    amount_cents: 300_00,
    hourly_rate_cents: null,
    hours_per_period: null,
    starts_on: null,
    ends_on: null,
    ...overrides,
  }
}

describe('activeNowTaxableInflows', () => {
  const now = new Date('2026-12-01T00:00:00Z')
  const recurring = inflow({ schedule: 'annual', interval_count: null })

  it('keeps an active recurring inflow with its effective dates cleared', () => {
    const dated = { ...recurring, starts_on: '2026-07-01', ends_on: '2027-06-30' }
    expect(activeNowTaxableInflows([dated], now)).toEqual([
      { ...dated, starts_on: null, ends_on: null },
    ])
  })

  it('keeps an open-ended recurring inflow untouched aside from the (already null) dates', () => {
    expect(activeNowTaxableInflows([recurring], now)).toEqual([recurring])
  })

  it('drops a recurring inflow that ended before now', () => {
    expect(activeNowTaxableInflows([{ ...recurring, ends_on: '2026-09-30' }], now)).toEqual([])
  })

  it('drops a recurring inflow that starts after now', () => {
    expect(activeNowTaxableInflows([{ ...recurring, starts_on: '2027-03-01' }], now)).toEqual([])
  })

  it('passes a one-off through unchanged, dates and all', () => {
    const oneOff = inflow({ schedule: null, interval_count: null, paid_on: '2026-08-15' })
    expect(activeNowTaxableInflows([oneOff], now)).toEqual([oneOff])
  })

  it('drops a non-taxable inflow', () => {
    expect(activeNowTaxableInflows([{ ...recurring, taxable: false }], now)).toEqual([])
  })
})
