import { describe, expect, it } from 'vitest'
import {
  isActiveOn,
  isTemporaryActive,
  summarise,
  type SummaryInput,
  type TemporaryItem,
} from './index'

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

describe('isActiveOn', () => {
  const now = new Date('2026-09-04T00:00:00Z')

  it('is active when no dates are set', () => {
    expect(isActiveOn({}, now)).toBe(true)
    expect(isActiveOn({ startsOn: null, endsOn: null }, now)).toBe(true)
  })

  it('honours an open-ended start (active from startsOn onwards)', () => {
    expect(isActiveOn({ startsOn: '2026-09-04' }, now)).toBe(true)
    expect(isActiveOn({ startsOn: '2026-09-05' }, now)).toBe(false)
  })

  it('honours an open-ended end (active up to and including endsOn)', () => {
    expect(isActiveOn({ endsOn: '2026-09-04' }, now)).toBe(true)
    expect(isActiveOn({ endsOn: '2026-09-03' }, now)).toBe(false)
  })

  it('requires now to fall within a closed window', () => {
    expect(isActiveOn({ startsOn: '2026-09-01', endsOn: '2026-09-30' }, now)).toBe(true)
    expect(isActiveOn({ startsOn: '2026-01-01', endsOn: '2026-06-30' }, now)).toBe(false)
    expect(isActiveOn({ startsOn: '2026-10-01', endsOn: '2026-12-31' }, now)).toBe(false)
  })
})

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

  it('normalizes an every-N-weeks budget line by its interval', () => {
    // $40 every 4 weeks → annual round(40_00 × 52 / 4) = 520_00, fortnightly round(520_00 / 26) = 20_00.
    const withInterval = summarise(
      {
        ...HOUSEHOLD,
        budgetLines: [
          { group: 'wants', amountCents: 40_00, frequency: 'every_n_weeks', interval: 4 },
        ],
      },
      NOW,
    )
    expect(withInterval.groups.wants.annualCents).toBe(520_00)
    expect(withInterval.groups.wants.fortnightlyCents).toBe(20_00)
  })

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

  it('counts a non-taxable inflow only while its effective window contains now', () => {
    const base = { amountCents: 200_00, frequency: 'fortnightly' } as const
    const at = (window: { startsOn?: string; endsOn?: string }) =>
      summarise({ ...HOUSEHOLD, nonTaxableInflows: [{ ...base, ...window }] }, NOW).available

    // NOW is 2026-07-19. Within, before, and after a closed window.
    expect(at({ startsOn: '2026-07-01', endsOn: '2026-12-31' })).toEqual(summary.available)
    expect(at({ startsOn: '2026-08-01', endsOn: '2026-12-31' }).annualCents).toBe(120_000_00)
    expect(at({ startsOn: '2026-08-01', endsOn: '2026-12-31' }).fortnightlyCents).toBe(
      Math.round(120_000_00 / 26),
    )
    expect(at({ startsOn: '2026-01-01', endsOn: '2026-06-30' }).annualCents).toBe(120_000_00)

    // Open-ended each side: active when the set bound still contains NOW.
    expect(at({ startsOn: '2026-07-01' })).toEqual(summary.available)
    expect(at({ endsOn: '2026-12-31' })).toEqual(summary.available)
    expect(at({ startsOn: '2026-08-01' }).annualCents).toBe(120_000_00)
    expect(at({ endsOn: '2026-06-30' }).annualCents).toBe(120_000_00)
  })

  it('leaves a non-taxable inflow with no effective dates in available', () => {
    // The HOUSEHOLD reimbursement carries no window and is counted in full.
    expect(summary.available.annualCents).toBe(125_200_00)
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

  it('derives the gross-basis tax and salary-sacrifice slices from the supplied annuals', () => {
    const withGross = summarise(
      { ...HOUSEHOLD, taxAnnualCents: 39_000_00, salarySacrificeAnnualCents: 13_000_00 },
      NOW,
    )
    expect(withGross.tax.annualCents).toBe(39_000_00)
    expect(withGross.tax.fortnightlyCents).toBe(Math.round(39_000_00 / 26))
    expect(withGross.salarySacrifice.annualCents).toBe(13_000_00)
    expect(withGross.salarySacrifice.fortnightlyCents).toBe(Math.round(13_000_00 / 26))
  })

  it('yields zero tax and salary sacrifice when those inputs are omitted', () => {
    expect(summary.tax).toEqual({ fortnightlyCents: 0, annualCents: 0 })
    expect(summary.salarySacrifice).toEqual({ fortnightlyCents: 0, annualCents: 0 })
  })

  it('reports one-off money beside the plan, out of available and every total', () => {
    // A $40,000 redundancy lands in the year. Were it available, the buffer would
    // rise by $1,538.46 every fortnight of the year on the strength of one payment.
    const withOneOff = summarise({ ...HOUSEHOLD, oneOffCents: 40_000_00 }, NOW)
    expect(withOneOff.oneOffCents).toBe(40_000_00)
    expect(withOneOff.available).toEqual(summary.available)
    expect(withOneOff.afterSaving).toEqual(summary.afterSaving)
    expect(withOneOff.groups).toEqual(summary.groups)
  })

  it('yields zero one-off money when that input is omitted', () => {
    expect(summary.oneOffCents).toBe(0)
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
