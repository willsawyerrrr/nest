import { describe, expect, it } from 'vitest'
import type { Tables } from './database.types'
import { dismissedGiftCandidates, giftCandidates, linkableGiftRecipients } from './giftCandidates'
import {
  discretionaryTotals,
  groupGifts,
  overallGiftTotals,
  unassignedSpentCents,
  type GiftGroup,
  type GiftGroupBy,
} from './gifts'

/**
 * The household the native Gifts screen is held to. The rows are written in full,
 * as PostgREST returns them for the signed-in member (so nothing row-level
 * security withholds is present), and the figures are what the PWA computes from
 * them: grouping, totals, the card inbox and the link choices. The fixture is
 * committed beside the iOS tests (`vitest -u` rewrites it); `GiftsParityTests`
 * decodes the same rows and must present identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/gifts-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }
const ME = 'm1'

const member = (id: string, name: string): Tables<'members'> => ({
  ...base,
  id,
  user_id: `u-${id}`,
  name,
  email: null,
  date_of_birth: null,
  up_connected_at: null,
  up_sync_failed_at: null,
})
const recipient = (id: string, name: string, member_id: string | null = null) => ({
  ...base,
  id,
  name,
  member_id,
})
const occasion = (id: string, name: string, occasion_date: string | null) => ({
  ...base,
  id,
  name,
  occasion_date,
})
const budget = (
  id: string,
  recipient_id: string,
  occasion_id: string,
  budgeted_amount_cents: number,
  event_date: string | null = null,
) => ({ ...base, id, recipient_id, occasion_id, budgeted_amount_cents, event_date })
const purchase = (
  id: string,
  amount_cents: number,
  fields: Partial<Tables<'gift_purchase'>>,
): Tables<'gift_purchase'> => ({
  ...base,
  id,
  amount_cents,
  description: id,
  purchased_on: '2026-02-01',
  gift_budget_id: null,
  gift_discretionary_budget_id: null,
  recipient_id: null,
  transaction_id: null,
  ...fields,
})
const transaction = (
  id: string,
  amount_cents: number,
  posted_at: string,
  status: Tables<'transactions'>['status'] = 'settled',
  description = id,
): Tables<'transactions'> => ({
  ...base,
  id,
  account_id: 'a1',
  amount_cents,
  category_id: null,
  description,
  external_category: 'gifts-and-charity',
  external_id: `ext-${id}`,
  kind: 'expense',
  member_id: ME,
  notes: null,
  posted_at,
  source: 'up',
  status,
})

const members = [member(ME, 'Will'), member('m2', 'Sam')]
const recipients = [
  recipient('r-mum', 'Mum'),
  recipient('r-sam', 'Sam', 'm2'),
  recipient('r-will', 'Will', ME),
  recipient('r-zed', 'Zed'),
  recipient('r-idle', 'Idle'),
]
const occasions = [
  occasion('o-xmas', 'Christmas', '2026-12-25'),
  occasion('o-bday', 'Birthday', null),
  occasion('o-ann', 'Anniversary', '2026-06-01'),
  occasion('o-none', 'Empty', null),
]
const budgets = [
  budget('b1', 'r-mum', 'o-xmas', 15000),
  budget('b2', 'r-sam', 'o-xmas', 20000),
  budget('b3', 'r-will', 'o-xmas', 25000),
  budget('b4', 'r-mum', 'o-bday', 10000, '2026-09-09'),
  budget('b5', 'r-zed', 'o-ann', 5000),
  budget('b6', 'r-will', 'o-bday', 7000),
]
const discretionary = [{ ...base, id: 'd1', budgeted_amount_cents: 8000 }]
const purchases = [
  purchase('p1', 6000, { gift_budget_id: 'b1', transaction_id: 't1' }),
  purchase('p2', 4550, { gift_budget_id: 'b1' }),
  purchase('p3', 21000, { gift_budget_id: 'b2' }),
  purchase('p4', 3000, { gift_discretionary_budget_id: 'd1', recipient_id: 'r-zed' }),
  purchase('p5', 1234, { gift_discretionary_budget_id: 'd1' }),
  purchase('p6', 999, {}),
  purchase('p7', 501, {}),
]
const transactions = [
  transaction('t1', -6000, '2026-02-01T12:00:00+00:00'),
  transaction('t2', -4200, '2026-03-05T12:00:00+00:00', 'pending', 'Toy shop'),
  transaction('t3', -9900, '2026-03-05T12:00:00+00:00', 'settled', ''),
  transaction('t4', -2500, '2026-01-20T12:00:00+00:00', 'settled', 'Charity run'),
  transaction('t5', -800, '2026-04-01T12:00:00+00:00', 'settled', 'Hidden dismissal'),
]
const dismissals = [
  { ...base, id: 'x1', transaction_id: 't4' },
  { ...base, id: 'x2', transaction_id: 'unseen' },
]

const hiddenBudgetIds = new Set(
  budgets
    .filter((row) => recipients.find((r) => r.id === row.recipient_id)?.member_id === ME)
    .map((row) => row.id),
)

function groups(groupBy: GiftGroupBy) {
  return groupGifts(recipients, occasions, budgets, purchases, groupBy).map((group: GiftGroup) => ({
    key: group.key,
    label: group.label,
    date: group.date,
    rows: group.rows.map((row) => ({
      budgetId: row.budgetId,
      recipientId: row.recipientId,
      occasionId: row.occasionId,
      label: row.label,
      date: row.date,
      totals: {
        budgetedCents: row.budgetedCents,
        spentCents: row.spentCents,
        remainingCents: row.remainingCents,
      },
      isHidden: hiddenBudgetIds.has(row.budgetId),
    })),
    totals: {
      budgetedCents: group.budgetedCents,
      spentCents: group.spentCents,
      remainingCents: group.remainingCents,
    },
    isHidden: group.rows.length > 0 && group.rows.every((row) => hiddenBudgetIds.has(row.budgetId)),
  }))
}

const triple = (t: { budgetedCents: number; spentCents: number; remainingCents: number }) => ({
  budgetedCents: t.budgetedCents,
  spentCents: t.spentCents,
  remainingCents: t.remainingCents,
})

const expected = {
  occasionGroups: groups('occasion'),
  personGroups: groups('person'),
  overall: triple(overallGiftTotals(budgets, purchases, discretionary[0]!)),
  discretionary: triple(discretionaryTotals(discretionary[0]!, purchases)),
  unassignedCents: unassignedSpentCents(purchases),
  candidates: giftCandidates(transactions, purchases, dismissals),
  dismissed: dismissedGiftCandidates(transactions, dismissals),
  linkChoices: linkableGiftRecipients(budgets, recipients, occasions, hiddenBudgetIds),
}

describe('the native Gifts parity fixture', () => {
  const text = `${JSON.stringify(
    [
      {
        name: 'a household with own gifts, ad hoc and unassigned purchases',
        currentMemberId: ME,
        rows: {
          recipients,
          occasions,
          budgets,
          purchases,
          discretionaryBudgets: discretionary,
          transactions,
          dismissals,
          members,
        },
        expected,
      },
    ],
    null,
    2,
  )}\n`

  it('matches what the PWA Gifts screen computes from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises hidden gifts, an empty group, a pending and a set-aside candidate', () => {
    expect(expected.occasionGroups.some((g) => g.isHidden)).toBe(false)
    expect(expected.personGroups.find((g) => g.key === 'r-will')?.isHidden).toBe(true)
    expect(expected.occasionGroups.find((g) => g.key === 'o-none')?.rows).toEqual([])
    expect(expected.candidates.some((c) => c.pending)).toBe(true)
    expect(expected.dismissed.map((c) => c.transactionId)).toEqual(['t4'])
    expect(expected.linkChoices.map((c) => c.label)).not.toContain('Will')
  })
})
