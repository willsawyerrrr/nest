import { describe, expect, it } from 'vitest'
import {
  assignmentsByAccount,
  isRecommendedSplitAccount,
  paySplitNeedsUpdate,
  resolveDestinationAccountId,
  roundCentsUpToStep,
  type AssignableLine,
  type RoutableGoal,
} from './index.ts'

/** A routable budget line, defaulting id and name a test does not pin. */
function makeLine(overrides: Partial<AssignableLine> = {}): AssignableLine {
  return {
    id: 'line',
    name: 'Line',
    group: 'needs',
    amountCents: 100_00,
    frequency: 'fortnightly',
    ...overrides,
  }
}

const GOALS: RoutableGoal[] = [
  { id: 'goal-linked', linkedAccountId: 'saver-emergency' },
  { id: 'goal-unlinked', linkedAccountId: null },
  { id: 'goal-missing-link' },
]

describe('resolveDestinationAccountId', () => {
  it('routes a savings line through its goal’s linked account', () => {
    const line = makeLine({ group: 'savings', amountCents: 500_00, goalId: 'goal-linked' })
    expect(resolveDestinationAccountId(line, GOALS)).toBe('saver-emergency')
  })

  it('routes an investments line through its goal’s linked account', () => {
    const line = makeLine({ group: 'investments', amountCents: 250_00, goalId: 'goal-linked' })
    expect(resolveDestinationAccountId(line, GOALS)).toBe('saver-emergency')
  })

  it('resolves to null for a savings line whose goal is unlinked', () => {
    const line = makeLine({ group: 'savings', amountCents: 500_00, goalId: 'goal-unlinked' })
    expect(resolveDestinationAccountId(line, GOALS)).toBeNull()
  })

  it('resolves to null for a savings line with no goal', () => {
    const line = makeLine({ group: 'savings', amountCents: 500_00, goalId: null })
    expect(resolveDestinationAccountId(line, GOALS)).toBeNull()
  })

  it('ignores a savings line’s own destination, routing only via its goal', () => {
    const line = makeLine({
      group: 'savings',
      amountCents: 500_00,
      goalId: 'goal-unlinked',
      destinationAccountId: 'saver-emergency',
    })
    expect(resolveDestinationAccountId(line, GOALS)).toBeNull()
  })

  it('routes a non-savings line through its own destination', () => {
    const line = makeLine({
      group: 'needs',
      amountCents: 1_000_00,
      destinationAccountId: 'txn-everyday',
    })
    expect(resolveDestinationAccountId(line, GOALS)).toBe('txn-everyday')
  })

  it('resolves to null for a non-savings line with no destination', () => {
    expect(
      resolveDestinationAccountId(makeLine({ group: 'wants', amountCents: 50_00 }), GOALS),
    ).toBeNull()
  })
})

describe('assignmentsByAccount', () => {
  it('sums each account’s fortnightly total across normalized frequencies', () => {
    const lines = [
      // $100/fortnightly + $260/monthly (annual 3_120_00 → 120_00/fn) to the same account.
      makeLine({ group: 'needs', amountCents: 100_00, destinationAccountId: 'txn' }),
      makeLine({
        group: 'wants',
        amountCents: 260_00,
        frequency: 'monthly',
        destinationAccountId: 'txn',
      }),
      // Savings routed via its linked goal.
      makeLine({ group: 'savings', amountCents: 500_00, goalId: 'goal-linked' }),
    ]
    const result = assignmentsByAccount(lines, GOALS)
    expect(result.byAccount).toEqual({ txn: 220_00, 'saver-emergency': 500_00 })
    expect(result.unassignedFortnightlyCents).toBe(0)
  })

  it('returns the contributing lines per account, each summing to the account total', () => {
    const lines = [
      makeLine({
        id: 'rent',
        name: 'Rent',
        group: 'needs',
        amountCents: 100_00,
        destinationAccountId: 'txn',
      }),
      makeLine({
        id: 'sub',
        name: 'Subscriptions',
        group: 'wants',
        amountCents: 260_00,
        frequency: 'monthly',
        destinationAccountId: 'txn',
      }),
      makeLine({
        id: 'save',
        name: 'Emergency fund',
        group: 'savings',
        amountCents: 500_00,
        goalId: 'goal-linked',
      }),
    ]
    const { linesByAccount, byAccount } = assignmentsByAccount(lines, GOALS)

    expect(linesByAccount).toEqual({
      txn: [
        { id: 'rent', name: 'Rent', fortnightlyCents: 100_00 },
        { id: 'sub', name: 'Subscriptions', fortnightlyCents: 120_00 },
      ],
      'saver-emergency': [{ id: 'save', name: 'Emergency fund', fortnightlyCents: 500_00 }],
    })
    for (const [accountId, accountLines] of Object.entries(linesByAccount)) {
      const summed = accountLines.reduce((total, line) => total + line.fortnightlyCents, 0)
      expect(summed).toBe(byAccount[accountId])
    }
  })

  it('collects unrouted lines into the unassigned bucket', () => {
    const lines = [
      // Investments whose goal has no linked account.
      makeLine({ group: 'investments', amountCents: 250_00, goalId: 'goal-unlinked' }),
      // A non-savings line with no destination set.
      makeLine({ group: 'discretionary', amountCents: 50_00 }),
    ]
    const result = assignmentsByAccount(lines, GOALS)
    expect(result.byAccount).toEqual({})
    expect(result.linesByAccount).toEqual({})
    expect(result.unassignedFortnightlyCents).toBe(300_00)
  })

  it('returns empty totals for no lines', () => {
    expect(assignmentsByAccount([], GOALS)).toEqual({
      byAccount: {},
      linesByAccount: {},
      unassignedFortnightlyCents: 0,
    })
  })
})

describe('roundCentsUpToStep', () => {
  it('rounds up to the next step, never below the amount', () => {
    expect(roundCentsUpToStep(12_49, 5_00)).toBe(15_00)
    expect(roundCentsUpToStep(12_50, 5_00)).toBe(15_00)
    expect(roundCentsUpToStep(10_01, 5_00)).toBe(15_00)
  })

  it('rounds a fraction of a step up to a full step', () => {
    expect(roundCentsUpToStep(1, 5_00)).toBe(5_00)
  })

  it('leaves an exact multiple unchanged', () => {
    expect(roundCentsUpToStep(500_00, 5_00)).toBe(500_00)
    expect(roundCentsUpToStep(0, 5_00)).toBe(0)
  })

  it('returns the amount unchanged for a non-positive step', () => {
    expect(roundCentsUpToStep(123_45, 0)).toBe(123_45)
    expect(roundCentsUpToStep(123_45, -5_00)).toBe(123_45)
  })
})

describe('paySplitNeedsUpdate', () => {
  it('needs update when the split has never been confirmed', () => {
    expect(paySplitNeedsUpdate(400_00, null)).toBe(true)
  })

  it('needs update when the recommendation differs from the confirmed amount', () => {
    expect(paySplitNeedsUpdate(400_00, 350_00)).toBe(true)
  })

  it('is up to date when the recommendation equals the confirmed amount', () => {
    expect(paySplitNeedsUpdate(400_00, 400_00)).toBe(false)
  })
})

describe('isRecommendedSplitAccount', () => {
  it('splits to every account but the pay account once one is designated', () => {
    expect(isRecommendedSplitAccount({ isPayAccount: false, isSaver: false }, true)).toBe(true)
    expect(isRecommendedSplitAccount({ isPayAccount: false, isSaver: true }, true)).toBe(true)
  })

  it('keeps the designated pay account out of the recommended splits', () => {
    expect(isRecommendedSplitAccount({ isPayAccount: true, isSaver: false }, true)).toBe(false)
  })

  it('splits only to savers until a pay account is designated', () => {
    expect(isRecommendedSplitAccount({ isPayAccount: false, isSaver: true }, false)).toBe(true)
    expect(isRecommendedSplitAccount({ isPayAccount: false, isSaver: false }, false)).toBe(false)
  })
})
