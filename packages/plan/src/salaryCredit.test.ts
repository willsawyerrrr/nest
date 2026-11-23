import { describe, expect, it } from 'vitest'
import {
  corroborateNetPay,
  modelledNetCents,
  type NetPaySlip,
  type SalaryCreditCandidate,
} from './index.ts'

const FY = 2027
const ALEX = 'alex'
const SAM = 'sam'

function slip(overrides: Partial<NetPaySlip> & Pick<NetPaySlip, 'id'>): NetPaySlip {
  return {
    memberId: ALEX,
    paidOn: '2026-07-13',
    periodStart: '2026-06-27',
    periodEnd: '2026-07-10',
    netCents: 3_645_50,
    modelledNetCents: null,
    ...overrides,
  }
}

function credit(
  overrides: Partial<SalaryCreditCandidate> & Pick<SalaryCreditCandidate, 'id'>,
): SalaryCreditCandidate {
  return {
    postedOn: '2026-07-13',
    amountCents: 3_645_50,
    memberId: null,
    payer: 'Acme Pty Ltd',
    transactionType: 'Direct Credit',
    ...overrides,
  }
}

describe('corroborateNetPay', () => {
  it('matches a joint-account credit carrying the slip net on its payment date', () => {
    const result = corroborateNetPay(FY, [ALEX, SAM], [slip({ id: 's1' })], [credit({ id: 'c1' })])
    expect(result.byPayslip.get('s1')).toEqual({
      status: 'matched',
      creditId: 'c1',
      postedOn: '2026-07-13',
      amountCents: 3_645_50,
      netDifferenceCents: 0,
      modelledDifferenceCents: null,
    })
    const alex = result.byMember.get(ALEX)!
    expect(alex.matchedCount).toBe(1)
    expect(alex.receivedCents).toBe(3_645_50)
    expect(alex.credits[0]!.payslipId).toBe('s1')
  })

  it('reports a credit within tolerance as differing, against both the slip and the model', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX],
      [slip({ id: 's1', modelledNetCents: 3_700_00 })],
      [credit({ id: 'c1', amountCents: 3_500_00, postedOn: '2026-07-14' })],
    )
    expect(result.byPayslip.get('s1')).toMatchObject({
      status: 'differs',
      netDifferenceCents: -145_50,
      modelledDifferenceCents: -200_00,
    })
  })

  it('treats a difference of a dollar or less as matching', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX],
      [slip({ id: 's1' })],
      [credit({ id: 'c1', amountCents: 3_646_50 })],
    )
    expect(result.byPayslip.get('s1')!.status).toBe('matched')
  })

  it('leaves a slip missing when the credit is outside the window, the tolerance, or another member’s', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX, SAM],
      [slip({ id: 's1' })],
      [
        credit({ id: 'late', postedOn: '2026-07-17' }),
        credit({ id: 'early', postedOn: '2026-07-11' }),
        credit({ id: 'far', amountCents: 3_000_00 }),
        credit({ id: 'sams', memberId: SAM }),
      ],
    )
    expect(result.byPayslip.get('s1')!.status).toBe('missing')
  })

  it('uses the week after the period for a slip stating no payment date', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX],
      [slip({ id: 's1', paidOn: null })],
      [credit({ id: 'c1', postedOn: '2026-07-17' })],
    )
    expect(result.byPayslip.get('s1')!.creditId).toBe('c1')
  })

  it('assigns the closest amount first, using each credit once', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX, SAM],
      [slip({ id: 'alex' }), slip({ id: 'sam', memberId: SAM, netCents: 3_500_00 })],
      [
        credit({ id: 'c-alex', payer: 'Acme' }),
        credit({ id: 'c-sam', amountCents: 3_500_00, payer: 'Initech' }),
      ],
    )
    expect(result.byPayslip.get('alex')!.creditId).toBe('c-alex')
    expect(result.byPayslip.get('sam')!.creditId).toBe('c-sam')
  })

  it('attributes later credits from a matched payer to the member, flagging cadence and amount drift', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX, SAM],
      [slip({ id: 's1' })],
      [
        credit({ id: 'c1' }),
        credit({ id: 'c2', postedOn: '2026-07-27', payer: ' acme pty ltd ' }),
        credit({ id: 'c3', postedOn: '2026-08-17', amountCents: 4_200_00 }),
        credit({ id: 'other', postedOn: '2026-07-27', payer: 'Someone else' }),
      ],
    )
    const alex = result.byMember.get(ALEX)!
    expect(alex.cadenceDays).toBe(14)
    expect(alex.credits.map((each) => each.id)).toEqual(['c3', 'c2', 'c1'])
    expect(alex.credits[0]).toMatchObject({
      payslipId: null,
      daysSincePrevious: 21,
      cadenceDrift: true,
      previousDifferenceCents: 554_50,
      amountDrift: true,
    })
    expect(alex.credits[1]).toMatchObject({ cadenceDrift: false, amountDrift: false })
    expect(alex.receivedCents).toBe(3_645_50 * 2 + 4_200_00)
  })

  it('drops a payer both members’ slips matched', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX, SAM],
      [slip({ id: 'alex' }), slip({ id: 'sam', memberId: SAM, netCents: 3_000_00 })],
      [
        credit({ id: 'c-alex', payer: 'Shared' }),
        credit({ id: 'c-sam', payer: 'Shared', amountCents: 3_000_00 }),
        credit({ id: 'later', payer: 'Shared', postedOn: '2026-07-27' }),
      ],
    )
    expect(result.byMember.get(ALEX)!.credits).toHaveLength(1)
    expect(result.byMember.get(SAM)!.credits).toHaveLength(1)
  })

  it('attributes Up salary credits on an own account, and leaves joint ones unattributed in a household of two', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX, SAM],
      [],
      [
        credit({ id: 'own', memberId: SAM, transactionType: 'Salary', payer: 'QVS' }),
        credit({ id: 'joint', transactionType: 'Salary', payer: 'QVS', postedOn: '2026-07-27' }),
        credit({ id: 'osko', transactionType: 'Osko Payment Received' }),
      ],
    )
    expect(result.byMember.get(SAM)!.credits.map((each) => each.id)).toEqual(['own'])
    expect(result.unattributed.map((each) => each.id)).toEqual(['joint'])
    expect(result.byMember.get(ALEX)!.credits).toEqual([])
  })

  it('attributes a joint Up salary credit to the only member of a one-member household', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX],
      [],
      [credit({ id: 'joint', transactionType: 'Salary' })],
    )
    expect(result.byMember.get(ALEX)!.credits).toHaveLength(1)
    expect(result.unattributed).toEqual([])
  })

  it('reads the cadence from the credits where no slip states one', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX],
      [],
      ['2026-07-01', '2026-07-15', '2026-07-29', '2026-08-12'].map((postedOn, index) =>
        credit({ id: `c${index}`, postedOn, transactionType: 'Salary' }),
      ),
    )
    expect(result.byMember.get(ALEX)!.cadenceDays).toBe(14)
    expect(result.byMember.get(ALEX)!.credits.some((each) => each.cadenceDrift)).toBe(false)
  })

  it('reads the cadence from the slips’ most common period length, the shorter on a tie', () => {
    const fortnight = { periodStart: '2026-06-27', periodEnd: '2026-07-10' }
    const week = { periodStart: '2026-07-11', periodEnd: '2026-07-17' }
    const cadence = (periods: (typeof week)[]) =>
      corroborateNetPay(
        FY,
        [ALEX],
        periods.map((period, index) => slip({ id: `s${index}`, ...period })),
        [],
      ).byMember.get(ALEX)!.cadenceDays
    expect(cadence([fortnight, week, fortnight])).toBe(14)
    expect(cadence([fortnight, week])).toBe(7)
    expect(cadence([week, fortnight])).toBe(7)
  })

  it('takes the middle of the two middle gaps for an even number of gaps', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX],
      [],
      ['2026-07-01', '2026-07-15', '2026-07-31'].map((postedOn, index) =>
        credit({ id: `c${index}`, postedOn, transactionType: 'Salary' }),
      ),
    )
    expect(result.byMember.get(ALEX)!.cadenceDays).toBe(15)
  })

  it('orders credits posted on the same day by id', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX],
      [],
      [
        credit({ id: 'b', memberId: ALEX, transactionType: 'Salary' }),
        credit({ id: 'a', memberId: ALEX, transactionType: 'Salary' }),
      ],
    )
    expect(result.byMember.get(ALEX)!.credits.map((each) => each.id)).toEqual(['b', 'a'])
  })

  it('attributes a matched payer’s credit on the member’s own account', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX, SAM],
      [slip({ id: 's1' })],
      [credit({ id: 'c1' }), credit({ id: 'own', memberId: ALEX, postedOn: '2026-07-27' })],
    )
    expect(result.byMember.get(ALEX)!.credits.map((each) => each.id)).toEqual(['own', 'c1'])
  })

  it('lists unattributed credits most recent first, then by id', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX, SAM],
      [],
      [
        credit({ id: 'j0', transactionType: 'Salary' }),
        credit({ id: 'j2', transactionType: 'Salary', postedOn: '2026-07-27' }),
        credit({ id: 'j1', transactionType: 'Salary', postedOn: '2026-07-27' }),
      ],
    )
    expect(result.unattributed.map((each) => each.id)).toEqual(['j1', 'j2', 'j0'])
  })

  it('matches across the year boundary but lists only credits posted in the year', () => {
    const result = corroborateNetPay(
      FY,
      [ALEX],
      [
        slip({
          id: 's1',
          paidOn: '2026-06-30',
          periodEnd: '2026-06-26',
          periodStart: '2026-06-13',
        }),
      ],
      [
        credit({ id: 'c1', postedOn: '2026-07-01' }),
        credit({ id: 'prior', postedOn: '2026-06-20', transactionType: 'Salary' }),
      ],
    )
    expect(result.byPayslip.get('s1')!.creditId).toBe('c1')
    expect(result.byMember.get(ALEX)!.credits.map((each) => each.id)).toEqual(['c1'])
  })
})

describe('modelledNetCents', () => {
  it('is the expected gross less the expected withholding', () => {
    expect(
      modelledNetCents({ expectedGrossCents: 5_000_00, expectedTaxWithheldCents: 1_200_00 }),
    ).toBe(3_800_00)
  })

  it('is null without a gross expectation', () => {
    expect(
      modelledNetCents({ expectedGrossCents: null, expectedTaxWithheldCents: 1_200_00 }),
    ).toBeNull()
  })
})
