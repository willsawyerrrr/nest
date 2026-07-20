import { describe, expect, it } from 'vitest'
import {
  budgetTotals,
  groupGifts,
  overallGiftTotals,
  spentCents,
  type GiftBudget,
  type GiftOccasion,
  type GiftPurchase,
  type GiftRecipient,
} from './gifts'

function recipient(id: string, name: string): GiftRecipient {
  return { id, name, household_id: 'h', created_at: '', updated_at: '' }
}

function occasion(id: string, name: string, occasion_date: string | null): GiftOccasion {
  return { id, name, occasion_date, household_id: 'h', created_at: '', updated_at: '' }
}

function budget(
  id: string,
  recipient_id: string,
  occasion_id: string,
  budgeted_amount_cents: number,
  event_date: string | null = null,
): GiftBudget {
  return {
    id,
    recipient_id,
    occasion_id,
    budgeted_amount_cents,
    event_date,
    household_id: 'h',
    created_at: '',
    updated_at: '',
  }
}

function purchase(id: string, gift_budget_id: string, amount_cents: number): GiftPurchase {
  return {
    id,
    gift_budget_id,
    amount_cents,
    description: '',
    purchased_on: '2026-01-01',
    household_id: 'h',
    created_at: '',
    updated_at: '',
  }
}

// A small fixture: two recipients, two occasions, three budgeted pairings.
const alice = recipient('r1', 'Alice')
const bob = recipient('r2', 'Bob')
const xmas = occasion('o1', 'Christmas', '2026-12-25')
const bday = occasion('o2', 'Birthday', '2026-06-01')
const undated = occasion('o3', 'Someday', null)

const budgets = [
  budget('b1', alice.id, xmas.id, 100_00),
  budget('b2', bob.id, xmas.id, 50_00),
  budget('b3', alice.id, bday.id, 40_00),
]

const purchases = [
  purchase('p1', 'b1', 30_00),
  purchase('p2', 'b1', 25_00),
  purchase('p3', 'b3', 60_00), // over the $40 budget
]

describe('spentCents', () => {
  it('sums only the purchases for the given budget', () => {
    expect(spentCents('b1', purchases)).toBe(55_00)
    expect(spentCents('b3', purchases)).toBe(60_00)
  })

  it('is zero for a budget with no purchases', () => {
    expect(spentCents('b2', purchases)).toBe(0)
  })
})

describe('budgetTotals', () => {
  it('reports budgeted, spent, and remaining', () => {
    expect(budgetTotals(budgets[0]!, purchases)).toEqual({
      budgetedCents: 100_00,
      spentCents: 55_00,
      remainingCents: 45_00,
    })
  })

  it('makes remaining negative when over budget', () => {
    expect(budgetTotals(budgets[2]!, purchases).remainingCents).toBe(-20_00)
  })
})

describe('overallGiftTotals', () => {
  it('rolls up budgeted, spent, and remaining across every budget', () => {
    // Budgeted 100 + 50 + 40 = 190; spent 55 (b1) + 60 (b3) = 115; remaining 75.
    expect(overallGiftTotals(budgets, purchases)).toEqual({
      budgetedCents: 190_00,
      spentCents: 115_00,
      remainingCents: 75_00,
    })
  })

  it('is all zeroes with no budgets', () => {
    expect(overallGiftTotals([], purchases)).toEqual({
      budgetedCents: 0,
      spentCents: 0,
      remainingCents: 0,
    })
  })
})

describe('groupGifts by occasion', () => {
  const groups = groupGifts([alice, bob], [xmas, bday, undated], budgets, purchases, 'occasion')

  it('orders groups by date then name, undated last', () => {
    expect(groups.map((group) => group.label)).toEqual(['Birthday', 'Christmas', 'Someday'])
  })

  it('carries the occasion date onto the group', () => {
    expect(groups[0]!.date).toBe('2026-06-01')
    expect(groups[2]!.date).toBeNull()
  })

  it('rolls up each occasion across its recipients', () => {
    const christmas = groups.find((group) => group.label === 'Christmas')!
    expect(christmas).toMatchObject({
      budgetedCents: 150_00,
      spentCents: 55_00,
      remainingCents: 95_00,
    })
  })

  it('lists recipient rows ordered by name', () => {
    const christmas = groups.find((group) => group.label === 'Christmas')!
    expect(christmas.rows.map((row) => row.label)).toEqual(['Alice', 'Bob'])
  })

  it('includes an occasion with no budgets as an empty group', () => {
    const someday = groups.find((group) => group.label === 'Someday')!
    expect(someday.rows).toEqual([])
    expect(someday.budgetedCents).toBe(0)
  })
})

describe('groupGifts by person', () => {
  const groups = groupGifts([bob, alice], [xmas, bday, undated], budgets, purchases, 'person')

  it('orders groups by recipient name', () => {
    expect(groups.map((group) => group.label)).toEqual(['Alice', 'Bob'])
  })

  it('rolls up each recipient across their occasions', () => {
    const aliceGroup = groups.find((group) => group.label === 'Alice')!
    expect(aliceGroup).toMatchObject({
      budgetedCents: 140_00,
      spentCents: 115_00,
      remainingCents: 25_00,
    })
  })

  it('orders occasion rows by date then name', () => {
    const aliceGroup = groups.find((group) => group.label === 'Alice')!
    expect(aliceGroup.rows.map((row) => row.label)).toEqual(['Birthday', 'Christmas'])
  })

  it('exposes a negative remaining on an over-budget row', () => {
    const aliceGroup = groups.find((group) => group.label === 'Alice')!
    const birthdayRow = aliceGroup.rows.find((row) => row.label === 'Birthday')!
    expect(birthdayRow.remainingCents).toBe(-20_00)
  })

  it('has no group for a recipient without records but still lists the recipient', () => {
    const carol = recipient('r3', 'Carol')
    const withCarol = groupGifts([alice, carol], [xmas], budgets, purchases, 'person')
    const carolGroup = withCarol.find((group) => group.label === 'Carol')!
    expect(carolGroup.rows).toEqual([])
  })
})

describe('gift row effective date', () => {
  it('falls back to the occasion date when the budget has no event_date', () => {
    const groups = groupGifts(
      [alice],
      [xmas],
      [budget('b1', alice.id, xmas.id, 100_00)],
      [],
      'person',
    )
    expect(groups[0]!.rows[0]!.date).toBe('2026-12-25')
  })

  it('prefers the budget event_date over the occasion date', () => {
    const groups = groupGifts(
      [alice],
      [xmas],
      [budget('b1', alice.id, xmas.id, 100_00, '2026-12-20')],
      [],
      'person',
    )
    expect(groups[0]!.rows[0]!.date).toBe('2026-12-20')
  })

  it('orders person rows by effective date, so an early event_date leads', () => {
    // Alice's birthday is nominally 2026-06-01, but her Christmas budget is dated
    // earlier via event_date, so it should sort ahead of the birthday.
    const groups = groupGifts(
      [alice],
      [xmas, bday],
      [
        budget('b1', alice.id, xmas.id, 100_00, '2026-05-01'),
        budget('b3', alice.id, bday.id, 40_00),
      ],
      [],
      'person',
    )
    expect(groups[0]!.rows.map((row) => row.label)).toEqual(['Christmas', 'Birthday'])
  })
})
