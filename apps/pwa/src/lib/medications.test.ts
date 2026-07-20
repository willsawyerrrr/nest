import { describe, expect, it } from 'vitest'
import { medicationsAnnualTotalCents, type Medication } from './medications'

function medication(
  id: string,
  amount_cents: number,
  frequency: Medication['frequency'],
  interval_weeks: number | null = null,
): Medication {
  return {
    id,
    name: id,
    dose: null,
    amount_cents,
    frequency,
    interval_weeks,
    household_id: 'h',
    created_at: '',
    updated_at: '',
  }
}

describe('medicationsAnnualTotalCents', () => {
  it('annualises each medication by its frequency and sums them', () => {
    // Monthly $20 → $240/yr; quarterly $30 → $120/yr; annual $50 → $50/yr.
    const total = medicationsAnnualTotalCents([
      medication('m1', 20_00, 'monthly'),
      medication('m2', 30_00, 'quarterly'),
      medication('m3', 50_00, 'annual'),
    ])
    expect(total).toBe(240_00 + 120_00 + 50_00)
  })

  it('annualises an every-N-weeks medication by its interval', () => {
    // $10 every 4 weeks → round(1000 * 52 / 4) = 13000 cents.
    expect(medicationsAnnualTotalCents([medication('m1', 10_00, 'every_n_weeks', 4)])).toBe(130_00)
  })

  it('is zero with no medications', () => {
    expect(medicationsAnnualTotalCents([])).toBe(0)
  })
})
