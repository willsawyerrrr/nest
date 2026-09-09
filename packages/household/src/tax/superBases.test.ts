import { describe, expect, it } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import type { InflowRow, MemberIdRow, SuperContributionRow, SuperProfileRow } from '../rows.ts'
import {
  assessableByMemberFromInflows,
  concessionalByMember,
  deductionsByMember,
  grossByMemberFromInflows,
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

const MEMBERS_ONE: MemberIdRow[] = [{ id: 'm1' }]
const MEMBERS_TWO: MemberIdRow[] = [{ id: 'm1' }, { id: 'm2' }]

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
      undefined,
      MEMBERS_ONE,
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
      MEMBERS_ONE,
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
    const result = netAnnualSuperContributionFromRows([salary, nonTaxable], [], MEMBERS_ONE)
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
    expect(netAnnualSuperContributionFromRows([salary, onCall], [], MEMBERS_ONE).get('m1')).toBe(
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
        MEMBERS_ONE,
      ).get('m1'),
    ).toBe(Math.round(0.12 * 45_000_00 * 0.85) + 1_000_00 + 243_10)
  })
})

describe('a joint inflow in the super bases', () => {
  const jointFor = (percent: number, amountCents = 10_000_00): InflowRow =>
    inflow({
      member_id: 'm1',
      type: 'other',
      schedule: 'annual',
      interval_count: null,
      amount_cents: amountCents,
      is_joint: true,
      member_split_percent: percent,
    })

  it('splits its annualised amount by member_split_percent in the ordinary time earnings base', () => {
    const gross = grossByMemberFromInflows([jointFor(70)], FY2027_CONFIG, ['m1', 'm2'])
    expect(gross.get('m1')).toBe(7_000_00)
    expect(gross.get('m2')).toBe(3_000_00)
  })

  it('splits it in the assessable income base even when it earns no super', () => {
    const joint = { ...jointFor(60), attracts_super: false }
    const assessable = assessableByMemberFromInflows([joint], FY2027_CONFIG, ['m1', 'm2'])
    expect(assessable.get('m1')).toBe(6_000_00)
    expect(assessable.get('m2')).toBe(4_000_00)
    // Still out of the ordinary time earnings base entirely — it earns no guarantee.
    expect(grossByMemberFromInflows([joint], FY2027_CONFIG, ['m1', 'm2']).get('m1')).toBeUndefined()
  })

  it('keeps the whole amount on the named member outside a two-member household', () => {
    expect(grossByMemberFromInflows([jointFor(70)], FY2027_CONFIG, ['m1']).get('m1')).toBe(
      10_000_00,
    )
    expect(
      assessableByMemberFromInflows([jointFor(70)], FY2027_CONFIG, ['m1', 'm2', 'm3']).get('m1'),
    ).toBe(10_000_00)
  })

  it('leaves a non-joint other inflow assessed wholly to its member', () => {
    const nonJoint = { ...jointFor(70), is_joint: false, member_split_percent: null }
    expect(grossByMemberFromInflows([nonJoint], FY2027_CONFIG, ['m1', 'm2']).get('m1')).toBe(
      10_000_00,
    )
    expect(
      grossByMemberFromInflows([nonJoint], FY2027_CONFIG, ['m1', 'm2']).get('m2'),
    ).toBeUndefined()
  })

  it('lifts the other member’s percent-of-salary sacrifice base by their share', () => {
    const salaryM2 = inflow({
      member_id: 'm2',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 90_000_00,
    })
    const sacrificeM2 = contribution({
      member_id: 'm2',
      kind: 'salary_sacrifice',
      mode: 'percent',
      amount_cents: null,
      percent_bp: 1000,
      frequency: 'annual',
    })
    const base = (rows: InflowRow[]) =>
      superCapSummaryFromRows(rows, [], [sacrificeM2], FY2027_CONFIG, MEMBERS_TWO).get('m2')!
        .concessionalCents
    // m2 takes 30% of the $10,000 joint inflow: a $93,000 base at 10%.
    expect(base([salaryM2, jointFor(70)])).toBe(9_300_00)
    expect(base([salaryM2, { ...jointFor(70), is_joint: false, member_split_percent: null }])).toBe(
      9_000_00,
    )
  })

  it('lifts the other member’s employer SG base by their share', () => {
    const salaryM2 = inflow({
      member_id: 'm2',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 80_000_00,
    })
    const net = (rows: InflowRow[]) =>
      netAnnualSuperContributionFromRows(rows, [], MEMBERS_TWO).get('m2')
    // m2's SG base becomes $83,000; the guarantee is taxed 15% in the fund.
    expect(net([salaryM2, jointFor(70)])).toBe(Math.round(0.12 * 83_000_00 * 0.85))
    expect(net([salaryM2, { ...jointFor(70), is_joint: false, member_split_percent: null }])).toBe(
      Math.round(0.12 * 80_000_00 * 0.85),
    )
  })

  it('splits the co-contribution income test across both members', () => {
    const salaryM2 = inflow({
      member_id: 'm2',
      schedule: 'annual',
      interval_count: null,
      amount_cents: 49_293_00,
    })
    const nonConcessionalM2 = contribution({
      member_id: 'm2',
      kind: 'personal_non_concessional',
      frequency: 'annual',
      amount_cents: 1_000_00,
    })
    const coContribution = (rows: InflowRow[]) =>
      superCapSummaryFromRows(rows, [], [nonConcessionalM2], FY2027_CONFIG, MEMBERS_TWO).get('m2')!
        .coContributionCents
    // m2's assessable income becomes $52,293, one fifth of the way up the taper.
    expect(coContribution([salaryM2, jointFor(70)])).toBe(400_00)
    expect(
      coContribution([salaryM2, { ...jointFor(70), is_joint: false, member_split_percent: null }]),
    ).toBe(500_00)
  })
})

describe('one-off inflows in the super bases', () => {
  it('earns no employer super, so it stays out of the guarantee base', () => {
    const salary = inflow({ schedule: 'annual', amount_cents: 100_000_00 })
    expect(netAnnualSuperContributionFromRows([salary, severance], [], MEMBERS_ONE).get('m1')).toBe(
      netAnnualSuperContributionFromRows([salary], [], MEMBERS_ONE).get('m1'),
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
    expect(
      superCapSummaryFromRows([redundancy], [], [nonConcessional], undefined, MEMBERS_ONE).get(
        'm1',
      ),
    ).toMatchObject({
      coContributionCents: 500_00,
    })
    expect(
      superCapSummaryFromRows(
        [{ ...redundancy, one_off_tax_treatment: 'ordinary', years_of_service: null }],
        [],
        [nonConcessional],
        undefined,
        MEMBERS_ONE,
      ).get('m1'),
    ).toMatchObject({ coContributionCents: 0 })
    expect(
      superCapSummaryFromRows(
        [{ ...redundancy, one_off_tax_treatment: null, years_of_service: null }],
        [],
        [nonConcessional],
        undefined,
        MEMBERS_ONE,
      ).get('m1'),
    ).toMatchObject({ coContributionCents: 0 })
  })
})
