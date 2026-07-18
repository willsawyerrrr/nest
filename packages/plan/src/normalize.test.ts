import { describe, expect, it } from 'vitest'
import { annualCents, fortnightlyCents } from './index'

describe('annualCents', () => {
  it('annualises an amount across every frequency', () => {
    expect(annualCents(1_000_00, 'weekly')).toBe(52_000_00)
    expect(annualCents(1_000_00, 'fortnightly')).toBe(26_000_00)
    expect(annualCents(1_000_00, 'monthly')).toBe(12_000_00)
    expect(annualCents(1_000_00, 'quarterly')).toBe(4_000_00)
    expect(annualCents(1_000_00, 'biannual')).toBe(2_000_00)
    expect(annualCents(1_000_00, 'annual')).toBe(1_000_00)
  })
})

describe('fortnightlyCents', () => {
  it('normalises fortnightly and annual amounts exactly', () => {
    expect(fortnightlyCents(1_000_00, 'fortnightly')).toBe(1_000_00)
    expect(fortnightlyCents(2_600_00, 'annual')).toBe(100_00)
  })

  it('rounds the per-fortnight share to whole cents', () => {
    // $800/month → $9,600/yr → 9_600_00 / 26 = 36_923.08 → 36_923.
    expect(fortnightlyCents(800_00, 'monthly')).toBe(369_23)
    // $50/month → $600/yr → 60_000 / 26 = 2_307.69 → 2_308.
    expect(fortnightlyCents(50_00, 'monthly')).toBe(23_08)
  })

  it('normalises weekly to a fortnight as twice the weekly amount', () => {
    expect(fortnightlyCents(500_00, 'weekly')).toBe(1_000_00)
  })
})
