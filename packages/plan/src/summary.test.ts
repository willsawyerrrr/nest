import { describe, expect, it } from 'vitest'
import { isTemporaryActive, summarise } from './index'
import type { SummaryInput, TemporaryItem } from './index'

const NOW = new Date('2026-07-19T00:00:00Z')

/** A realistic single household plan evaluated at NOW. */
const HOUSEHOLD: SummaryInput = {
  afterTaxIncomeAnnualCents: 120_000_00,
  nonTaxableInflows: [
    // A capped work reimbursement, always spent, modelled as fortnightly cash in.
    { amountCents: 200_00, frequency: 'fortnightly' },
  ],
  budgetLines: [
    { group: 'needs', amountCents: 2_000_00, frequency: 'fortnightly' },
    { group: 'needs', amountCents: 800_00, frequency: 'monthly' },
    { group: 'wants', amountCents: 50_00, frequency: 'monthly' },
    { group: 'discretionary', amountCents: 300_00, frequency: 'fortnightly' },
    { group: 'savings', amountCents: 500_00, frequency: 'fortnightly' },
    { group: 'investments', amountCents: 250_00, frequency: 'fortnightly' },
  ],
  temporaryItems: [
    { contributionCents: 100_00, targetDate: '2026-12-31' }, // active at NOW
    { contributionCents: 75_00, targetDate: '2026-06-30' }, // expired before NOW
  ],
}

describe('isTemporaryActive', () => {
  it('is active up to and including the target date, expired after', () => {
    const item: TemporaryItem = { contributionCents: 100_00, targetDate: '2026-12-31' }
    expect(isTemporaryActive(item, new Date('2026-07-19T00:00:00Z'))).toBe(true)
    expect(isTemporaryActive(item, new Date('2026-12-31T00:00:00Z'))).toBe(true)
    expect(isTemporaryActive(item, new Date('2027-01-01T00:00:00Z'))).toBe(false)
  })
})

describe('summarise', () => {
  const summary = summarise(HOUSEHOLD, NOW)

  it('reconciles available from after-tax income and non-taxable inflows', () => {
    // $120,000/yr after tax → 12_000_000 / 26 = 461_538 fortnightly, plus $200 in.
    expect(summary.available.annualCents).toBe(125_200_00)
    expect(summary.available.fortnightlyCents).toBe(4_815_38)
  })

  it('totals each group, deriving Temporary from active items only', () => {
    // Needs: $2,000/fn (200_000) + $800/mo (36_923) = 236_923.
    expect(summary.groups.needs.fortnightlyCents).toBe(2_369_23)
    expect(summary.groups.needs.annualCents).toBe(61_600_00)
    expect(summary.groups.wants.fortnightlyCents).toBe(23_08)
    expect(summary.groups.discretionary.fortnightlyCents).toBe(300_00)
    expect(summary.groups.savings.fortnightlyCents).toBe(500_00)
    expect(summary.groups.investments.fortnightlyCents).toBe(250_00)
    // Only the active temporary item's $100 contributes; the expired one drops out.
    expect(summary.groups.temporary.fortnightlyCents).toBe(100_00)
    expect(summary.groups.temporary.annualCents).toBe(2_600_00)
  })

  it('excludes an expired temporary item from Temporary', () => {
    const expiredOnly = summarise(
      { ...HOUSEHOLD, temporaryItems: [{ contributionCents: 75_00, targetDate: '2026-06-30' }] },
      NOW,
    )
    expect(expiredOnly.groups.temporary.fortnightlyCents).toBe(0)
    expect(expiredOnly.groups.temporary.annualCents).toBe(0)
  })

  it('reconciles outgoings, savings block, and the running remainders', () => {
    // Outgoings = Needs + Wants + Discretionary + Temporary.
    expect(summary.outgoings.fortnightlyCents).toBe(2_792_31)
    expect(summary.outgoings.annualCents).toBe(72_600_00)
    // Savings block = Savings + Investments.
    expect(summary.savingsBlock.fortnightlyCents).toBe(750_00)
    expect(summary.savingsBlock.annualCents).toBe(19_500_00)
    // After Outgoing = Available − Outgoings.
    expect(summary.afterOutgoing.fortnightlyCents).toBe(2_023_07)
    expect(summary.afterOutgoing.annualCents).toBe(52_600_00)
    // After Saving (buffer) = After Outgoing − Savings block.
    expect(summary.afterSaving.fortnightlyCents).toBe(1_273_07)
    expect(summary.afterSaving.annualCents).toBe(33_100_00)
  })

  it('reports each group portion as its share of available fortnightly cash', () => {
    expect(summary.groups.needs.portion).toBeCloseTo(2_369_23 / 4_815_38, 6)
    expect(summary.groups.temporary.portion).toBeCloseTo(100_00 / 4_815_38, 6)
  })

  it('guards portion against divide-by-zero when nothing is available', () => {
    const broke = summarise(
      {
        afterTaxIncomeAnnualCents: 0,
        nonTaxableInflows: [],
        budgetLines: HOUSEHOLD.budgetLines,
        temporaryItems: [],
      },
      NOW,
    )
    expect(broke.available.fortnightlyCents).toBe(0)
    expect(broke.groups.needs.portion).toBe(0)
  })
})
