import { describe, expect, it } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import type { InflowRow, SuperContributionRow, SuperProfileRow } from '../rows.ts'
import {
  concessionalByMember,
  deductionsByMember,
  helpDebtCentsByMember,
  netAnnualSuperContributionByMember,
  netAnnualSuperContributionFromRows,
  nonConcessionalByMember,
  superCapSummaryByMember,
  superCapSummaryFromRows,
} from '../tax.ts'

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

const baseProfile: SuperProfileRow = { member_id: 'm1', carry_forward_cap_cents: 0 }

function contribution(overrides: Partial<SuperContributionRow> = {}): SuperContributionRow {
  return {
    member_id: 'm1',
    kind: 'salary_sacrifice',
    mode: 'amount',
    amount_cents: 500_00,
    percent_bp: null,
    frequency: 'fortnightly',
    interval_count: null,
    ...overrides,
  }
}

/** A taxable one-off severance for `m1`, paid inside FY2027. */
const severance = inflow({
  schedule: null,
  interval_count: null,
  paid_on: '2026-09-12',
  one_off_tax_treatment: 'ordinary',
  amount_cents: 40_000_00,
})

describe('concessionalByMember', () => {
  it('annualises an amount-mode concessional contribution by frequency', () => {
    expect(concessionalByMember([contribution()], new Map()).get('m1')).toBe(13_000_00)
  })

  it('resolves a percent-mode contribution against the member gross salary', () => {
    const percentRow = contribution({
      kind: 'personal_deductible',
      mode: 'percent',
      amount_cents: null,
      percent_bp: 1000,
      frequency: 'annual',
    })
    expect(concessionalByMember([percentRow], new Map([['m1', 100_000_00]])).get('m1')).toBe(
      10_000_00,
    )
  })

  it('sums concessional kinds and excludes non-concessional and spouse contributions', () => {
    const rows: SuperContributionRow[] = [
      contribution(),
      contribution({ kind: 'personal_deductible', frequency: 'annual' }),
      contribution({ kind: 'personal_non_concessional', frequency: 'annual' }),
      contribution({ kind: 'spouse' }),
    ]
    expect(concessionalByMember(rows, new Map()).get('m1')).toBe(13_000_00 + 500_00)
  })

  it('yields zero for a percent-mode contribution with no rate against an unknown member gross', () => {
    const percentRow = contribution({
      mode: 'percent',
      amount_cents: null,
      percent_bp: null,
      frequency: 'annual',
    })
    expect(concessionalByMember([percentRow], new Map()).get('m1')).toBe(0)
  })

  it('yields zero for an amount-mode contribution with no amount', () => {
    const amountRow = contribution({ mode: 'amount', amount_cents: null, frequency: 'annual' })
    expect(concessionalByMember([amountRow], new Map()).get('m1')).toBe(0)
  })
})

describe('deductionsByMember', () => {
  it('sums each member deduction amount by member id', () => {
    const result = deductionsByMember([
      { member_id: 'm1', amount_cents: 1_200_00 },
      { member_id: 'm1', amount_cents: 300_00 },
      { member_id: 'm2', amount_cents: 500_00 },
    ])
    expect(result.get('m1')).toBe(1_500_00)
    expect(result.get('m2')).toBe(500_00)
  })
})

describe('helpDebtCentsByMember', () => {
  it('keys each member HELP balance by member id', () => {
    const result = helpDebtCentsByMember([
      { member_id: 'm1', balance_cents: 30_000_00 },
      { member_id: 'm2', balance_cents: 5_000_00 },
    ])
    expect(result.get('m1')).toBe(30_000_00)
    expect(result.get('m2')).toBe(5_000_00)
  })
})

describe('nonConcessionalByMember', () => {
  const nonConcessional = contribution({ kind: 'personal_non_concessional' })

  it('annualises an amount-mode non-concessional contribution by frequency', () => {
    expect(nonConcessionalByMember([nonConcessional], new Map()).get('m1')).toBe(13_000_00)
  })

  it('resolves a percent-mode contribution against the member gross salary', () => {
    const percentRow = contribution({
      kind: 'personal_non_concessional',
      mode: 'percent',
      amount_cents: null,
      percent_bp: 500,
      frequency: 'annual',
    })
    expect(nonConcessionalByMember([percentRow], new Map([['m1', 100_000_00]])).get('m1')).toBe(
      5_000_00,
    )
  })

  it('excludes concessional and spouse contributions', () => {
    const rows: SuperContributionRow[] = [
      nonConcessional,
      contribution({ kind: 'salary_sacrifice' }),
      contribution({ kind: 'spouse' }),
    ]
    expect(nonConcessionalByMember(rows, new Map()).get('m1')).toBe(13_000_00)
  })
})

describe('superCapSummaryByMember', () => {
  it('flags concessional over the effective cap, including carry-forward', () => {
    const concessional = contribution({
      kind: 'salary_sacrifice',
      frequency: 'annual',
      amount_cents: 40_000_00,
    })
    const withCarry = superCapSummaryByMember(
      [concessional],
      [{ ...baseProfile, carry_forward_cap_cents: 10_000_00 }],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    ).get('m1')!
    expect(withCarry.concessionalCapCents).toBe(42_500_00)
    expect(withCarry.concessionalOverCap).toBe(false)

    const noCarry = superCapSummaryByMember(
      [concessional],
      [baseProfile],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    ).get('m1')!
    expect(noCarry.concessionalCapCents).toBe(32_500_00)
    expect(noCarry.concessionalOverCap).toBe(true)
  })

  it('flags non-concessional over the cap and reports the co-contribution', () => {
    const over = contribution({
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 140_000_00,
    })
    const summary = superCapSummaryByMember(
      [over],
      [baseProfile],
      new Map([['m1', 40_000_00]]),
      new Map([['m1', 40_000_00]]),
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.nonConcessionalCapCents).toBe(130_000_00)
    expect(summary.nonConcessionalOverCap).toBe(true)
    expect(summary.coContributionCents).toBe(500_00)
  })

  it('produces a zero-usage entry for a member with only a profile', () => {
    const summary = superCapSummaryByMember(
      [],
      [baseProfile],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.concessionalCents).toBe(0)
    expect(summary.nonConcessionalCents).toBe(0)
    expect(summary.coContributionCents).toBe(0)
  })

  it('applies the bare config cap to a contributing member who has no super profile', () => {
    const summaries = superCapSummaryByMember(
      [
        contribution({
          member_id: 'm2',
          kind: 'salary_sacrifice',
          frequency: 'annual',
          amount_cents: 5_000_00,
        }),
      ],
      [{ ...baseProfile, member_id: 'm1' }],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    )
    expect(summaries.get('m2')!.concessionalCapCents).toBe(32_500_00)
    expect(summaries.get('m2')!.concessionalCents).toBe(5_000_00)
  })

  it('tests the co-contribution against assessable income, not ordinary time earnings', () => {
    const summary = superCapSummaryByMember(
      [
        contribution({
          kind: 'personal_non_concessional',
          frequency: 'annual',
          amount_cents: 1_000_00,
        }),
      ],
      [baseProfile],
      new Map([['m1', 45_000_00]]),
      new Map([['m1', 57_000_00]]),
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.coContributionCents).toBe(243_10)
  })
})

describe('superCapSummaryFromRows', () => {
  it('derives the co-contribution income test from taxable inflows', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 49_293_00 })
    const summary = superCapSummaryFromRows(
      [salary],
      [baseProfile],
      [
        contribution({
          kind: 'personal_non_concessional',
          frequency: 'annual',
          amount_cents: 1_000_00,
        }),
      ],
    ).get('m1')!
    expect(summary.nonConcessionalCents).toBe(1_000_00)
    expect(summary.coContributionCents).toBe(500_00)
  })

  it('counts an allowance that earns no super toward the co-contribution income test', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 45_000_00 })
    const onCall = inflow({
      attracts_super: false,
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 12_000_00,
    })
    const summary = superCapSummaryFromRows(
      [salary, onCall],
      [baseProfile],
      [
        contribution({
          kind: 'personal_non_concessional',
          frequency: 'annual',
          amount_cents: 1_000_00,
        }),
      ],
      FY2027_CONFIG,
    ).get('m1')!
    expect(summary.coContributionCents).toBe(243_10)
  })
})

describe('netAnnualSuperContributionByMember', () => {
  it('taxes concessional and employer SG at 15% and adds after-tax amounts untaxed', () => {
    const grossByMember = new Map([['m1', 100_000_00]])
    const result = netAnnualSuperContributionByMember(
      [contribution()],
      grossByMember,
      grossByMember,
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(21_250_00)
  })

  it('adds non-concessional contributions and the co-contribution without taxing them', () => {
    const grossByMember = new Map([['m1', 49_293_00]])
    const sgAfterTax = Math.round(0.12 * 49_293_00 * 0.85)
    const result = netAnnualSuperContributionByMember(
      [
        contribution({
          kind: 'personal_non_concessional',
          frequency: 'annual',
          amount_cents: 1_000_00,
        }),
      ],
      grossByMember,
      grossByMember,
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(sgAfterTax + 1_000_00 + 500_00)
  })

  it('produces an entry from gross salary alone (employer SG, after tax)', () => {
    const grossByMember = new Map([['m1', 80_000_00]])
    const result = netAnnualSuperContributionByMember(
      [],
      grossByMember,
      grossByMember,
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(Math.round(0.12 * 80_000_00 * 0.85))
  })

  it('taxes a contribution with no gross salary, contributing no employer SG', () => {
    const result = netAnnualSuperContributionByMember(
      [contribution()],
      new Map(),
      new Map(),
      FY2027_CONFIG,
    )
    expect(result.get('m1')).toBe(Math.round(13_000_00 * 0.85))
  })
})

describe('netAnnualSuperContributionFromRows', () => {
  it('derives gross from taxable inflows and skips non-taxable ones', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 100_000_00 })
    const nonTaxable = inflow({
      taxable: false,
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 5_000_00,
    })
    const result = netAnnualSuperContributionFromRows([salary, nonTaxable], [])
    expect(result.get('m1')).toBe(
      netAnnualSuperContributionByMember(
        [],
        new Map([['m1', 100_000_00]]),
        new Map([['m1', 100_000_00]]),
        FY2027_CONFIG,
      ).get('m1'),
    )
  })

  it('leaves an allowance that earns no super out of the employer SG base', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 100_000_00 })
    const onCall = inflow({
      attracts_super: false,
      schedule: 'fortnightly',
      interval_count: null,
      amount_cents: 500_00,
    })
    expect(netAnnualSuperContributionFromRows([salary, onCall], []).get('m1')).toBe(
      Math.round(0.12 * 100_000_00 * 0.85),
    )
  })

  it('counts an allowance that earns no super toward the co-contribution income test', () => {
    const salary = inflow({ schedule: 'annual', interval_count: null, amount_cents: 45_000_00 })
    const onCall = inflow({
      attracts_super: false,
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 12_000_00,
    })
    expect(
      netAnnualSuperContributionFromRows(
        [salary, onCall],
        [
          contribution({
            kind: 'personal_non_concessional',
            frequency: 'annual',
            amount_cents: 1_000_00,
          }),
        ],
      ).get('m1'),
    ).toBe(Math.round(0.12 * 45_000_00 * 0.85) + 1_000_00 + 243_10)
  })
})

describe('one-off inflows in the super bases', () => {
  it('earns no employer super, so it stays out of the guarantee base', () => {
    const salary = inflow({ schedule: 'annual', amount_cents: 100_000_00 })
    expect(netAnnualSuperContributionFromRows([salary, severance], []).get('m1')).toBe(
      netAnnualSuperContributionFromRows([salary], []).get('m1'),
    )
  })

  it('counts its assessable part in the co-contribution income test, tax-free part aside', () => {
    const redundancy = {
      ...severance,
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 5,
      amount_cents: 70_000_00,
    }
    const nonConcessional = contribution({
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 1_000_00,
    })
    expect(superCapSummaryFromRows([redundancy], [], [nonConcessional]).get('m1')).toMatchObject({
      coContributionCents: 500_00,
    })
    expect(
      superCapSummaryFromRows(
        [{ ...redundancy, one_off_tax_treatment: 'ordinary', years_of_service: null }],
        [],
        [nonConcessional],
      ).get('m1'),
    ).toMatchObject({ coContributionCents: 0 })
    expect(
      superCapSummaryFromRows(
        [{ ...redundancy, one_off_tax_treatment: null, years_of_service: null }],
        [],
        [nonConcessional],
      ).get('m1'),
    ).toMatchObject({ coContributionCents: 0 })
  })
})
