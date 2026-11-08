import { describe, expect, it } from 'vitest'
import { budgetOverview, type BudgetLine, type MemberAllowance } from './index.ts'

const ADA: MemberAllowance = { memberId: 'ada', amountCents: 200_00, frequency: 'fortnightly' }

const lines: BudgetLine[] = [
  { group: 'needs', amountCents: 1_000_00, frequency: 'monthly' },
  { group: 'discretionary', amountCents: 50_00, frequency: 'fortnightly' },
  {
    group: 'discretionary',
    amountCents: 80_00,
    frequency: 'fortnightly',
    allowanceMemberId: 'ada',
  },
  { group: 'savings', amountCents: 300_00, frequency: 'every_n_weeks', interval: 3 },
]

describe('budgetOverview', () => {
  it('normalises each line in input order', () => {
    const overview = budgetOverview(lines, [ADA])
    expect(overview.lines[0]).toEqual({ fortnightlyCents: 461_54, annualCents: 12_000_00 })
    expect(overview.lines[3]!.annualCents).toBe(5_200_00)
  })

  it('counts a drawn line inside the allowance, not on top of Discretionary', () => {
    const { groups } = budgetOverview(lines, [ADA])
    expect(groups.discretionary).toBe(50_00 + 200_00)
    expect(groups.needs).toBe(461_54)
    expect(groups.wants).toBe(0)
  })

  it('treats a line naming a member with no allowance as ordinary', () => {
    const { groups } = budgetOverview(lines, [])
    expect(groups.discretionary).toBe(130_00)
  })

  it('reconciles the allowance', () => {
    const [ada] = budgetOverview(lines, [ADA]).allowances
    expect(ada!.drawn.fortnightlyCents).toBe(80_00)
    expect(ada!.remaining.fortnightlyCents).toBe(120_00)
  })
})
