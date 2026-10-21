import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { giftContext, SELF } from '../test/giftFake.ts'
import {
  addGiftPurchase,
  deleteGiftPurchase,
  dismissGiftCandidate,
  listGiftCandidates,
  restoreGiftCandidate,
  updateGiftPurchase,
} from './giftPurchases.ts'
import {
  addGiftBudget,
  addGiftBudgetInput,
  addGiftOccasion,
  addGiftRecipient,
  deleteGiftBudget,
  deleteGiftOccasion,
  deleteGiftRecipient,
  listGifts,
  setGiftDiscretionaryBudget,
  updateGiftBudget,
  updateGiftOccasion,
  updateGiftRecipient,
} from './gifts.ts'

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

const recipients = [
  { id: 'r-nan', household_id: 'h-1', name: 'Nan', member_id: null },
  { id: 'r-self', household_id: 'h-1', name: 'Alex', member_id: SELF },
  { id: 'r-sam', household_id: 'h-1', name: 'Sam', member_id: 'm-other' },
]
const occasions = [
  { id: 'o-xmas', name: 'Christmas', occasion_date: '2026-12-25' },
  { id: 'o-bday', name: 'Birthday', occasion_date: null },
]
const budgets = [
  {
    id: 'b-nan',
    recipient_id: 'r-nan',
    occasion_id: 'o-xmas',
    budgeted_amount_cents: 100_00,
    event_date: null,
  },
  {
    id: 'b-self',
    recipient_id: 'r-self',
    occasion_id: 'o-xmas',
    budgeted_amount_cents: 80_00,
    event_date: null,
  },
  {
    id: 'b-sam',
    recipient_id: 'r-sam',
    occasion_id: 'o-bday',
    budgeted_amount_cents: 50_00,
    event_date: '2026-11-01',
  },
]
// Row-level security has already withheld the purchases for Alex's own gift.
const purchases = [
  {
    id: 'p-1',
    gift_budget_id: 'b-nan',
    gift_discretionary_budget_id: null,
    recipient_id: null,
    amount_cents: 30_00,
    description: 'Scarf',
    purchased_on: '2026-10-01',
    transaction_id: null,
  },
  {
    id: 'p-adhoc',
    gift_budget_id: null,
    gift_discretionary_budget_id: 'd-1',
    recipient_id: 'r-nan',
    amount_cents: 12_00,
    description: 'Card',
    purchased_on: '2026-09-01',
    transaction_id: null,
  },
  {
    id: 'p-loose',
    gift_budget_id: null,
    gift_discretionary_budget_id: null,
    recipient_id: null,
    amount_cents: 5_00,
    description: 'Wrapping paper',
    purchased_on: '2026-08-01',
    transaction_id: null,
  },
  {
    id: 'p-linked',
    gift_budget_id: 'b-sam',
    gift_discretionary_budget_id: null,
    recipient_id: null,
    amount_cents: 20_00,
    description: 'Book',
    purchased_on: '2026-10-05',
    transaction_id: 't-linked',
  },
]
const tables = () => ({
  gift_recipient: recipients,
  gift_occasion: occasions,
  gift_budget: budgets,
  gift_purchase: purchases,
  gift_discretionary_budget: [{ id: 'd-1', household_id: 'h-1', budgeted_amount_cents: 40_00 }],
})

describe('listGifts', () => {
  it("reports spent and remaining, withholding them for the member's own gifts", async () => {
    const { ctx } = giftContext({ tables: tables() })
    const result = await listGifts(ctx)
    const byId = Object.fromEntries(result.budgets.map((b) => [b.id, b]))
    expect(byId['b-nan']).toMatchObject({ spent_cents: 30_00, remaining_cents: 70_00 })
    expect(byId['b-sam']).toMatchObject({ date: '2026-11-01', spent_cents: 20_00 })
    expect(byId['b-self']).toMatchObject({
      private: true,
      spent_cents: null,
      remaining_cents: null,
    })
    expect(result.recipients.find((r) => r.id === 'r-self')).toMatchObject({
      is_member: true,
      is_you: true,
    })
    expect(result.discretionary).toEqual({
      id: 'd-1',
      budgeted_amount_cents: 40_00,
      spent_cents: 12_00,
      remaining_cents: 28_00,
    })
    expect(result.unassigned_spent_cents).toBe(5_00)
    expect(result.purchases.map((p) => p.id)).toEqual(['p-linked', 'p-1', 'p-adhoc', 'p-loose'])
  })

  it('reads a household with no buffer as a zero one', async () => {
    const { ctx } = giftContext()
    const result = await listGifts(ctx)
    expect(result.discretionary).toEqual({
      id: null,
      budgeted_amount_cents: 0,
      spent_cents: 0,
      remaining_cents: 0,
    })
  })
})

describe('listGiftCandidates', () => {
  it('offers unclaimed, undismissed gift transactions newest first, and lists dismissals', async () => {
    const { ctx } = giftContext({
      tables: {
        ...tables(),
        transactions: [
          {
            id: 't-new',
            description: 'Etsy',
            amount_cents: -45_50,
            posted_at: '2026-10-10T20:00:00Z',
            status: 'settled',
            external_category: 'gifts-and-charity',
          },
          {
            id: 't-old',
            description: 'Toys',
            amount_cents: -10_00,
            posted_at: '2026-09-01T02:00:00Z',
            status: 'pending',
            external_category: 'gifts-and-charity',
          },
          {
            id: 't-linked',
            description: 'Book',
            amount_cents: -20_00,
            posted_at: '2026-10-05T02:00:00Z',
            status: 'settled',
            external_category: 'gifts-and-charity',
          },
          {
            id: 't-charity',
            description: 'Red Cross',
            amount_cents: -5_00,
            posted_at: '2026-10-06T02:00:00Z',
            status: 'settled',
            external_category: 'gifts-and-charity',
          },
          {
            id: 't-food',
            description: 'Cafe',
            amount_cents: -9_00,
            posted_at: '2026-10-07T02:00:00Z',
            status: 'settled',
            external_category: 'restaurants',
          },
        ],
        gift_transaction_dismissal: [{ id: 'x-1', transaction_id: 't-charity' }],
      },
    })
    const result = await listGiftCandidates(ctx)
    expect(result.candidates).toEqual([
      {
        transaction_id: 't-new',
        description: 'Etsy',
        amount_cents: 45_50,
        posted_on: '2026-10-11',
        pending: false,
      },
      {
        transaction_id: 't-old',
        description: 'Toys',
        amount_cents: 10_00,
        posted_on: '2026-09-01',
        pending: true,
      },
    ])
    expect(result.dismissed).toMatchObject([{ dismissal_id: 'x-1', transaction_id: 't-charity' }])
  })
})

describe('recipients', () => {
  it('adds an external recipient to the household', async () => {
    const { ctx, state } = giftContext()
    await expect(addGiftRecipient(ctx, { name: 'Pop' })).resolves.toEqual({
      id: 'new-1',
      name: 'Pop',
    })
    expect(state.inserts).toEqual([
      { table: 'gift_recipient', row: { household_id: 'h-1', name: 'Pop' } },
    ])
  })

  it('renames and deletes an external recipient', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await updateGiftRecipient(ctx, { id: 'r-nan', name: 'Grandma' })
    await deleteGiftRecipient(ctx, { id: 'r-nan' })
    expect(state.updates).toEqual([{ table: 'gift_recipient', row: { name: 'Grandma' } }])
    expect(state.deletes).toEqual([{ table: 'gift_recipient', id: 'r-nan' }])
  })

  it('refuses to edit or delete a member recipient', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    expect((await failure(updateGiftRecipient(ctx, { id: 'r-sam', name: 'X' }))).code).toBe(
      'member_recipient',
    )
    expect((await failure(deleteGiftRecipient(ctx, { id: 'r-self' }))).code).toBe(
      'member_recipient',
    )
    expect(state.updates).toEqual([])
    expect(state.deletes).toEqual([])
  })

  it('reports an unknown recipient and a failed write with fixed copy', async () => {
    const missing = giftContext({ tables: tables() })
    expect((await failure(deleteGiftRecipient(missing.ctx, { id: 'nope' }))).code).toBe('not_found')
    const broken = giftContext({ writeError: true })
    const error = await failure(addGiftRecipient(broken.ctx, { name: 'Pop' }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('occasions', () => {
  it('adds, edits, clears the date of, and deletes an occasion', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await expect(addGiftOccasion(ctx, { name: 'Easter' })).resolves.toMatchObject({
      occasion_date: null,
    })
    await expect(updateGiftOccasion(ctx, { id: 'o-xmas', occasion_date: null })).resolves.toEqual({
      id: 'o-xmas',
      name: 'Christmas',
      occasion_date: null,
    })
    await expect(updateGiftOccasion(ctx, { id: 'o-bday', name: 'Birthdays' })).resolves.toEqual({
      id: 'o-bday',
      name: 'Birthdays',
      occasion_date: null,
    })
    await deleteGiftOccasion(ctx, { id: 'o-xmas' })
    expect(state.deletes).toEqual([{ table: 'gift_occasion', id: 'o-xmas' }])
  })

  it('reports an unknown occasion', async () => {
    const { ctx } = giftContext()
    expect((await failure(updateGiftOccasion(ctx, { id: 'nope', name: 'X' }))).code).toBe(
      'not_found',
    )
    expect((await failure(deleteGiftOccasion(ctx, { id: 'nope' }))).code).toBe('not_found')
  })
})

describe('budgets', () => {
  it('plans a budget for a free recipient and occasion pair', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    const result = await addGiftBudget(ctx, {
      recipient_id: 'r-nan',
      occasion_id: 'o-bday',
      budgeted_amount_cents: 60_00,
      event_date: '2026-11-20',
    })
    expect(result).toMatchObject({ id: 'new-1', budgeted_amount_cents: 60_00 })
    expect(state.inserts[0]).toEqual({
      table: 'gift_budget',
      row: {
        household_id: 'h-1',
        recipient_id: 'r-nan',
        occasion_id: 'o-bday',
        budgeted_amount_cents: 60_00,
        event_date: '2026-11-20',
      },
    })
  })

  it('refuses a second budget for the same pair and unknown references', async () => {
    const { ctx } = giftContext({ tables: tables() })
    const taken = { recipient_id: 'r-nan', occasion_id: 'o-xmas', budgeted_amount_cents: 1 }
    expect((await failure(addGiftBudget(ctx, taken))).code).toBe('invalid_details')
    expect((await failure(addGiftBudget(ctx, { ...taken, recipient_id: 'nope' }))).code).toBe(
      'not_found',
    )
    expect((await failure(addGiftBudget(ctx, { ...taken, occasion_id: 'nope' }))).code).toBe(
      'not_found',
    )
  })

  it('rejects a negative or fractional amount', () => {
    const base = { recipient_id: crypto.randomUUID(), occasion_id: crypto.randomUUID() }
    expect(addGiftBudgetInput.safeParse({ ...base, budgeted_amount_cents: -1 }).success).toBe(false)
    expect(addGiftBudgetInput.safeParse({ ...base, budgeted_amount_cents: 1.5 }).success).toBe(
      false,
    )
  })

  it('edits only the fields given, and clears the event date', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await updateGiftBudget(ctx, { id: 'b-sam', event_date: null })
    await updateGiftBudget(ctx, { id: 'b-nan', budgeted_amount_cents: 120_00 })
    expect(state.updates[0]?.row).toMatchObject({ event_date: null, budgeted_amount_cents: 50_00 })
    expect(state.updates[1]?.row).toMatchObject({ budgeted_amount_cents: 120_00 })
  })

  it('refuses to move a budget onto a taken pair', async () => {
    const { ctx } = giftContext({ tables: tables() })
    const error = await failure(
      updateGiftBudget(ctx, { id: 'b-sam', occasion_id: 'o-xmas', recipient_id: 'r-nan' }),
    )
    expect(error.code).toBe('invalid_details')
  })

  it('deletes a budget', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await deleteGiftBudget(ctx, { id: 'b-nan' })
    expect(state.deletes).toEqual([{ table: 'gift_budget', id: 'b-nan' }])
    expect((await failure(deleteGiftBudget(ctx, { id: 'nope' }))).code).toBe('not_found')
  })
})

describe('setGiftDiscretionaryBudget', () => {
  it("upserts the household's single buffer row", async () => {
    const { ctx, state } = giftContext()
    await expect(
      setGiftDiscretionaryBudget(ctx, { budgeted_amount_cents: 75_00 }),
    ).resolves.toEqual({ id: 'buffer-1', budgeted_amount_cents: 75_00 })
    expect(state.upserts).toEqual([
      {
        table: 'gift_discretionary_budget',
        row: { household_id: 'h-1', budgeted_amount_cents: 75_00 },
        onConflict: 'household_id',
      },
    ])
  })

  it('reports a failed upsert with fixed copy', async () => {
    const { ctx } = giftContext({ writeError: true })
    expect(
      (await failure(setGiftDiscretionaryBudget(ctx, { budgeted_amount_cents: 1 }))).code,
    ).toBe('save_failed')
  })
})

describe('addGiftPurchase', () => {
  it('logs a purchase against a gift budget', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await addGiftPurchase(ctx, {
      gift_budget_id: 'b-sam',
      amount_cents: 15_00,
      description: 'Socks',
      purchased_on: '2026-10-09',
    })
    expect(state.inserts[0]).toEqual({
      table: 'gift_purchase',
      row: {
        household_id: 'h-1',
        gift_budget_id: 'b-sam',
        gift_discretionary_budget_id: null,
        recipient_id: null,
        amount_cents: 15_00,
        description: 'Socks',
        purchased_on: '2026-10-09',
        transaction_id: null,
      },
    })
  })

  it('logs an ad hoc purchase against the buffer, tagged with a recipient', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await addGiftPurchase(ctx, {
      ad_hoc: true,
      recipient_id: 'r-nan',
      amount_cents: 9_00,
      purchased_on: '2026-10-09',
    })
    expect(state.inserts[0]?.row).toMatchObject({
      gift_budget_id: null,
      gift_discretionary_budget_id: 'd-1',
      recipient_id: 'r-nan',
      description: '',
    })
  })

  it('logs an unassigned purchase', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await addGiftPurchase(ctx, { amount_cents: 3_00, purchased_on: '2026-10-09' })
    expect(state.inserts[0]?.row).toMatchObject({
      gift_budget_id: null,
      gift_discretionary_budget_id: null,
    })
  })

  it('needs the ad hoc buffer to exist', async () => {
    const { ctx } = giftContext()
    const error = await failure(
      addGiftPurchase(ctx, { ad_hoc: true, amount_cents: 1, purchased_on: '2026-10-09' }),
    )
    expect(error.code).toBe('invalid_details')
  })

  it('links a card transaction, taking its amount and local date', async () => {
    const { ctx, state } = giftContext({
      tables: {
        ...tables(),
        transactions: [
          {
            id: 't-new',
            description: 'Etsy',
            amount_cents: -45_50,
            posted_at: '2026-10-10T20:00:00Z',
            status: 'settled',
            external_category: 'gifts-and-charity',
          },
        ],
      },
    })
    await addGiftPurchase(ctx, {
      gift_budget_id: 'b-nan',
      transaction_id: 't-new',
      description: 'Mug',
    })
    expect(state.inserts[0]?.row).toMatchObject({
      amount_cents: 45_50,
      purchased_on: '2026-10-11',
      transaction_id: 't-new',
      description: 'Mug',
    })
  })

  it('refuses a linked purchase that states its own amount, and a non-gift transaction', async () => {
    const { ctx } = giftContext({
      tables: {
        transactions: [
          {
            id: 't-food',
            description: 'Cafe',
            amount_cents: -9_00,
            posted_at: '2026-10-07T02:00:00Z',
            status: 'settled',
            external_category: 'restaurants',
          },
        ],
      },
    })
    expect(
      (await failure(addGiftPurchase(ctx, { transaction_id: 't-food', amount_cents: 1 }))).code,
    ).toBe('invalid_details')
    expect((await failure(addGiftPurchase(ctx, { transaction_id: 't-food' }))).code).toBe(
      'not_found',
    )
    expect((await failure(addGiftPurchase(ctx, { transaction_id: 'nope' }))).code).toBe('not_found')
  })

  it("refuses to log a purchase for the member's own gift", async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    const own = { amount_cents: 1_00, purchased_on: '2026-10-09' }
    expect((await failure(addGiftPurchase(ctx, { ...own, gift_budget_id: 'b-self' }))).code).toBe(
      'private_gift',
    )
    expect(
      (await failure(addGiftPurchase(ctx, { ...own, ad_hoc: true, recipient_id: 'r-self' }))).code,
    ).toBe('private_gift')
    expect(state.inserts).toEqual([])
  })

  it('requires an amount and date, and a coherent destination', async () => {
    const { ctx } = giftContext({ tables: tables() })
    expect((await failure(addGiftPurchase(ctx, { amount_cents: 1 }))).code).toBe('invalid_details')
    const dated = { amount_cents: 1, purchased_on: '2026-10-09' }
    expect(
      (await failure(addGiftPurchase(ctx, { ...dated, gift_budget_id: 'b-nan', ad_hoc: true })))
        .code,
    ).toBe('invalid_details')
    expect(
      (
        await failure(
          addGiftPurchase(ctx, { ...dated, gift_budget_id: 'b-nan', recipient_id: 'r-nan' }),
        )
      ).code,
    ).toBe('invalid_details')
  })

  it('reports a failed insert with fixed copy', async () => {
    const { ctx } = giftContext({ tables: tables(), writeError: true })
    const error = await failure(
      addGiftPurchase(ctx, {
        gift_budget_id: 'b-nan',
        amount_cents: 1,
        purchased_on: '2026-10-09',
      }),
    )
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('updateGiftPurchase', () => {
  it("edits a hand-entered purchase's fields", async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await updateGiftPurchase(ctx, { id: 'p-1', amount_cents: 35_00, description: 'Gloves' })
    expect(state.updates[0]).toEqual({
      table: 'gift_purchase',
      row: {
        gift_budget_id: 'b-nan',
        gift_discretionary_budget_id: null,
        recipient_id: null,
        amount_cents: 35_00,
        description: 'Gloves',
        purchased_on: '2026-10-01',
      },
    })
  })

  it('moves an unassigned purchase to a budget, and a budget one to the buffer', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await updateGiftPurchase(ctx, { id: 'p-loose', gift_budget_id: 'b-sam' })
    await updateGiftPurchase(ctx, { id: 'p-1', ad_hoc: true, recipient_id: 'r-nan' })
    await updateGiftPurchase(ctx, { id: 'p-adhoc', unassigned: true })
    expect(state.updates[0]?.row).toMatchObject({
      gift_budget_id: 'b-sam',
      gift_discretionary_budget_id: null,
    })
    expect(state.updates[1]?.row).toMatchObject({
      gift_budget_id: null,
      gift_discretionary_budget_id: 'd-1',
      recipient_id: 'r-nan',
    })
    expect(state.updates[2]?.row).toMatchObject({
      gift_budget_id: null,
      gift_discretionary_budget_id: null,
      recipient_id: null,
    })
  })

  it("tags and untags an ad hoc purchase's recipient, keeping it otherwise", async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await updateGiftPurchase(ctx, { id: 'p-adhoc', recipient_id: null })
    await updateGiftPurchase(ctx, { id: 'p-adhoc', description: 'Greeting card' })
    expect(state.updates[0]?.row).toMatchObject({ recipient_id: null })
    expect(state.updates[1]?.row).toMatchObject({ recipient_id: 'r-nan' })
    expect(
      (await failure(updateGiftPurchase(ctx, { id: 'p-1', recipient_id: 'r-nan' }))).code,
    ).toBe('invalid_details')
  })

  it("keeps a linked purchase's amount and date", async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    expect((await failure(updateGiftPurchase(ctx, { id: 'p-linked', amount_cents: 1 }))).code).toBe(
      'invalid_details',
    )
    await updateGiftPurchase(ctx, { id: 'p-linked', description: 'Novel' })
    expect(state.updates).toHaveLength(1)
  })

  it("refuses to move a purchase onto the member's own gift", async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    expect(
      (await failure(updateGiftPurchase(ctx, { id: 'p-1', gift_budget_id: 'b-self' }))).code,
    ).toBe('private_gift')
    expect(
      (await failure(updateGiftPurchase(ctx, { id: 'p-adhoc', recipient_id: 'r-self' }))).code,
    ).toBe('private_gift')
    expect(state.updates).toEqual([])
  })

  it('cannot see, so cannot edit, a purchase row-level security withholds', async () => {
    const { ctx } = giftContext({ tables: tables() })
    expect(
      (await failure(updateGiftPurchase(ctx, { id: 'p-hidden', description: 'x' }))).code,
    ).toBe('not_found')
  })

  it('refuses more than one destination', async () => {
    const { ctx } = giftContext({ tables: tables() })
    expect(
      (await failure(updateGiftPurchase(ctx, { id: 'p-1', ad_hoc: true, unassigned: true }))).code,
    ).toBe('invalid_details')
  })
})

describe('deleteGiftPurchase', () => {
  it('deletes a visible purchase and not a hidden one', async () => {
    const { ctx, state } = giftContext({ tables: tables() })
    await deleteGiftPurchase(ctx, { id: 'p-1' })
    expect(state.deletes).toEqual([{ table: 'gift_purchase', id: 'p-1' }])
    expect((await failure(deleteGiftPurchase(ctx, { id: 'p-hidden' }))).code).toBe('not_found')
  })
})

describe('dismissals', () => {
  const transactions = [
    {
      id: 't-charity',
      description: 'Red Cross',
      amount_cents: -5_00,
      posted_at: '2026-10-06T02:00:00Z',
      status: 'settled',
      external_category: 'gifts-and-charity',
    },
    {
      id: 't-food',
      description: 'Cafe',
      amount_cents: -9_00,
      posted_at: '2026-10-07T02:00:00Z',
      status: 'settled',
      external_category: 'restaurants',
    },
  ]

  it('sets a gift transaction aside', async () => {
    const { ctx, state } = giftContext({ tables: { transactions } })
    await expect(dismissGiftCandidate(ctx, { transaction_id: 't-charity' })).resolves.toEqual({
      dismissal_id: 'new-1',
      transaction_id: 't-charity',
    })
    expect(state.inserts).toEqual([
      {
        table: 'gift_transaction_dismissal',
        row: { household_id: 'h-1', transaction_id: 't-charity' },
      },
    ])
  })

  it('refuses a transaction that is not visible or not a gift one', async () => {
    const { ctx } = giftContext({ tables: { transactions } })
    expect((await failure(dismissGiftCandidate(ctx, { transaction_id: 't-food' }))).code).toBe(
      'not_found',
    )
    expect((await failure(dismissGiftCandidate(ctx, { transaction_id: 'nope' }))).code).toBe(
      'not_found',
    )
  })

  it('restores a dismissal', async () => {
    const { ctx, state } = giftContext({
      tables: { gift_transaction_dismissal: [{ id: 'x-1', transaction_id: 't-charity' }] },
    })
    await restoreGiftCandidate(ctx, { dismissal_id: 'x-1' })
    expect(state.deletes).toEqual([{ table: 'gift_transaction_dismissal', id: 'x-1' }])
    expect((await failure(restoreGiftCandidate(ctx, { dismissal_id: 'nope' }))).code).toBe(
      'not_found',
    )
  })
})
