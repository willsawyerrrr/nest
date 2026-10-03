import { describe, expect, it } from 'vitest'
import {
  assignmentsByAccount,
  isDrawnFromAllowance,
  summarise,
  summariseAllowances,
  type AssignableAllowance,
  type AssignableLine,
  type BudgetLine,
  type MemberAllowance,
  type SummaryInput,
} from './index.ts'

const NOW = new Date('2026-07-19T00:00:00Z')

const ADA: MemberAllowance = { memberId: 'ada', amountCents: 200_00, frequency: 'fortnightly' }

/** A Discretionary line drawn from Ada's allowance. */
function drawn(amountCents: number, overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    group: 'discretionary',
    amountCents,
    frequency: 'fortnightly',
    allowanceMemberId: 'ada',
    ...overrides,
  }
}

describe('isDrawnFromAllowance', () => {
  it('is true only for a line naming a member who has an allowance', () => {
    expect(isDrawnFromAllowance(drawn(1_00), [ADA])).toBe(true)
    expect(isDrawnFromAllowance(drawn(1_00, { allowanceMemberId: 'bob' }), [ADA])).toBe(false)
    expect(isDrawnFromAllowance(drawn(1_00, { allowanceMemberId: null }), [ADA])).toBe(false)
    expect(isDrawnFromAllowance({}, [ADA])).toBe(false)
  })
})

describe('summariseAllowances', () => {
  it('reports the allowance, what is drawn, and what remains', () => {
    const [ada] = summariseAllowances([drawn(60_00), drawn(40_00)], [ADA])
    expect(ada).toEqual({
      memberId: 'ada',
      allowance: { fortnightlyCents: 200_00, annualCents: 5_200_00 },
      drawn: { fortnightlyCents: 100_00, annualCents: 2_600_00 },
      remaining: { fortnightlyCents: 100_00, annualCents: 2_600_00 },
      outgoing: { fortnightlyCents: 200_00, annualCents: 5_200_00 },
      overdrawn: false,
    })
  })

  it('normalises drawn lines on their own cadence', () => {
    // $100 monthly = $1,200 a year, $46.15 a fortnight.
    const [ada] = summariseAllowances([drawn(100_00, { frequency: 'monthly' })], [ADA])
    expect(ada!.drawn).toEqual({ fortnightlyCents: 46_15, annualCents: 1_200_00 })
  })

  it('normalises an every-N-weeks allowance by its interval', () => {
    // $300 every 3 weeks = $5,200 a year.
    const [ada] = summariseAllowances(
      [],
      [{ ...ADA, amountCents: 300_00, frequency: 'every_n_weeks', interval: 3 }],
    )
    expect(ada!.allowance.annualCents).toBe(5_200_00)
  })

  it('flags an overdrawn allowance and counts the excess as outgoing', () => {
    const [ada] = summariseAllowances([drawn(150_00), drawn(100_00)], [ADA])
    expect(ada!.overdrawn).toBe(true)
    expect(ada!.remaining.fortnightlyCents).toBe(-50_00)
    expect(ada!.outgoing.fortnightlyCents).toBe(250_00)
  })

  it('is not overdrawn when drawn exactly equals the allowance', () => {
    const [ada] = summariseAllowances([drawn(200_00)], [ADA])
    expect(ada!.overdrawn).toBe(false)
    expect(ada!.remaining.fortnightlyCents).toBe(0)
  })

  it('ignores lines drawn from another member', () => {
    const [ada] = summariseAllowances([drawn(50_00, { allowanceMemberId: 'bob' })], [ADA])
    expect(ada!.drawn.fortnightlyCents).toBe(0)
  })
})

describe('summarise with allowances', () => {
  const base: SummaryInput = {
    afterTaxIncomeAnnualCents: 130_000_00,
    nonTaxableInflows: [],
    budgetLines: [{ group: 'discretionary', amountCents: 50_00, frequency: 'fortnightly' }],
    temporaryItems: [],
  }

  it('counts the allowance as Discretionary, with drawn lines inside it', () => {
    const summary = summarise(
      {
        ...base,
        budgetLines: [...base.budgetLines, drawn(60_00), drawn(40_00)],
        memberAllowances: [ADA],
      },
      NOW,
    )
    // $50 undrawn + the $200 allowance; the $100 drawn adds nothing.
    expect(summary.groups.discretionary.fortnightlyCents).toBe(250_00)
    expect(summary.groups.discretionary.annualCents).toBe(6_500_00)
    expect(summary.outgoings.fortnightlyCents).toBe(250_00)
    expect(summary.allowances).toHaveLength(1)
    expect(summary.allowances[0]!.remaining.fortnightlyCents).toBe(100_00)
  })

  it('counts an allowance with nothing drawn in full', () => {
    const summary = summarise({ ...base, memberAllowances: [ADA] }, NOW)
    expect(summary.groups.discretionary.fortnightlyCents).toBe(250_00)
  })

  it('counts the excess of an overdrawn allowance so the buffer stays honest', () => {
    const summary = summarise(
      { ...base, budgetLines: [drawn(260_00)], memberAllowances: [ADA] },
      NOW,
    )
    expect(summary.groups.discretionary.fortnightlyCents).toBe(260_00)
    expect(summary.allowances[0]!.overdrawn).toBe(true)
  })

  it('treats a line drawn from a member with no allowance as an ordinary line', () => {
    const summary = summarise({ ...base, budgetLines: [drawn(60_00)] }, NOW)
    expect(summary.groups.discretionary.fortnightlyCents).toBe(60_00)
    expect(summary.allowances).toEqual([])
  })

  it('leaves the buffer unchanged by drawing a line within the allowance', () => {
    const without = summarise({ ...base, memberAllowances: [ADA] }, NOW)
    const within = summarise(
      { ...base, budgetLines: [...base.budgetLines, drawn(120_00)], memberAllowances: [ADA] },
      NOW,
    )
    expect(within.afterSaving).toEqual(without.afterSaving)
  })
})

describe('assignmentsByAccount with allowances', () => {
  const line = (overrides: Partial<AssignableLine>): AssignableLine => ({
    id: 'line',
    name: 'Line',
    group: 'discretionary',
    amountCents: 100_00,
    frequency: 'fortnightly',
    ...overrides,
  })
  const allowance: AssignableAllowance = {
    ...ADA,
    name: 'Ada’s allowance',
    destinationAccountId: 'ada-spending',
  }

  it('routes the allowance to its account and drawn lines with it', () => {
    const result = assignmentsByAccount(
      [
        line({ id: 'gym', name: 'Gym', amountCents: 60_00, allowanceMemberId: 'ada' }),
        line({ id: 'coffee', name: 'Coffee', amountCents: 40_00, allowanceMemberId: 'ada' }),
        line({ id: 'rent', group: 'needs', name: 'Rent', destinationAccountId: 'joint' }),
      ],
      [],
      [allowance],
    )
    expect(result.byAccount).toEqual({ joint: 100_00, 'ada-spending': 200_00 })
    expect(result.linesByAccount['ada-spending']).toEqual([
      { id: 'allowance:ada', name: 'Ada’s allowance', fortnightlyCents: 200_00 },
    ])
    expect(result.unassignedFortnightlyCents).toBe(0)
  })

  it('routes an overdrawn allowance for what is drawn', () => {
    const result = assignmentsByAccount(
      [line({ id: 'gym', amountCents: 260_00, allowanceMemberId: 'ada' })],
      [],
      [allowance],
    )
    expect(result.byAccount).toEqual({ 'ada-spending': 260_00 })
  })

  it('leaves an unrouted allowance unassigned', () => {
    const result = assignmentsByAccount([], [], [{ ...allowance, destinationAccountId: null }])
    expect(result.unassignedFortnightlyCents).toBe(200_00)
    expect(result.byAccount).toEqual({})
  })

  it('routes a line drawn from a member with no allowance as an ordinary line', () => {
    const result = assignmentsByAccount(
      [line({ amountCents: 30_00, allowanceMemberId: 'ada', destinationAccountId: 'joint' })],
      [],
      [],
    )
    expect(result.byAccount).toEqual({ joint: 30_00 })
  })
})
