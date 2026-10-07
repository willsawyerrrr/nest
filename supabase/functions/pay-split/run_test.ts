import { assertEquals } from '@std/assert'
import {
  type AccountRow,
  type BudgetLineRow,
  type PaySplitDeps,
  type PaySplitRows,
  runPaySplit,
  shapePaySplit,
} from './run.ts'

function line(overrides: Partial<BudgetLineRow> = {}): BudgetLineRow {
  return {
    id: 'l1',
    name: 'Rent',
    line_group: 'needs',
    amount_cents: 200_00,
    frequency: 'fortnightly',
    interval_count: null,
    goal_id: null,
    destination_account_id: 'bills',
    allowance_member_id: null,
    ...overrides,
  }
}

function account(overrides: Partial<AccountRow> = {}): AccountRow {
  return { id: 'bills', name: 'Bills', source: 'up', type: 'transaction', ...overrides }
}

function rows(overrides: Partial<PaySplitRows> = {}): PaySplitRows {
  return {
    budgetLines: [line()],
    goals: [],
    allowances: [],
    members: [],
    accounts: [account(), account({ id: 'pay', name: 'Spending' })],
    payAccountId: 'pay',
    ...overrides,
  }
}

Deno.test('shapePaySplit recommends each non-pay account, rounded up to $5', () => {
  const body = shapePaySplit(rows({ budgetLines: [line({ amount_cents: 201_00 })] }))

  assertEquals(body, {
    hasPayAccount: true,
    splits: [{ accountId: 'bills', name: 'Bills', fortnightlyCents: 205_00 }],
    totalCents: 205_00,
    stays: [],
    unassignedFortnightlyCents: 0,
  })
})

Deno.test('shapePaySplit keeps the pay account under stays', () => {
  const body = shapePaySplit(rows({
    budgetLines: [line(), line({ id: 'l2', name: 'Food', destination_account_id: 'pay' })],
  }))

  assertEquals(body.splits.map((s) => s.accountId), ['bills'])
  assertEquals(body.stays, [{ accountId: 'pay', name: 'Spending', fortnightlyCents: 200_00 }])
})

Deno.test('shapePaySplit recommends savers only until a pay account is designated', () => {
  const body = shapePaySplit(rows({
    payAccountId: null,
    accounts: [account(), account({ id: 'sav', name: '✈️ Japan', type: 'savings' })],
    budgetLines: [line(), line({ id: 'l2', name: 'Japan', destination_account_id: 'sav' })],
  }))

  assertEquals(body.hasPayAccount, false)
  assertEquals(body.splits, [{ accountId: 'sav', name: 'Japan', fortnightlyCents: 200_00 }])
  assertEquals(body.stays.map((s) => s.accountId), ['bills'])
})

Deno.test('shapePaySplit routes a savings line through its goal and normalises cadence', () => {
  const body = shapePaySplit(rows({
    accounts: [account({ id: 'sav', name: 'Holiday', type: 'savings' })],
    goals: [{ id: 'g1', linked_account_id: 'sav' }],
    budgetLines: [line({
      line_group: 'savings',
      goal_id: 'g1',
      destination_account_id: null,
      amount_cents: 100_00,
      frequency: 'weekly',
    })],
  }))

  assertEquals(body.splits, [{ accountId: 'sav', name: 'Holiday', fortnightlyCents: 200_00 }])
})

Deno.test('shapePaySplit routes an allowance through its own account and skips drawn lines', () => {
  const body = shapePaySplit(rows({
    members: [{ id: 'm1', name: 'Ada' }],
    allowances: [{
      member_id: 'm1',
      amount_cents: 100_00,
      frequency: 'fortnightly',
      interval_count: null,
      destination_account_id: 'bills',
    }],
    budgetLines: [line({ allowance_member_id: 'm1', amount_cents: 40_00 })],
  }))

  assertEquals(body.splits, [{ accountId: 'bills', name: 'Bills', fortnightlyCents: 100_00 }])
})

Deno.test('shapePaySplit ignores an allowance whose member is unknown', () => {
  const body = shapePaySplit(rows({
    allowances: [{
      member_id: 'gone',
      amount_cents: 100_00,
      frequency: 'fortnightly',
      interval_count: 3,
      destination_account_id: 'bills',
    }],
    budgetLines: [],
  }))

  assertEquals(body.splits, [])
})

Deno.test('shapePaySplit totals unrouted lines and skips unknown accounts', () => {
  const body = shapePaySplit(rows({
    budgetLines: [
      line({ destination_account_id: null, amount_cents: 50_00, interval_count: 2 }),
      line({ id: 'l2', destination_account_id: 'deleted' }),
    ],
  }))

  assertEquals(body.splits, [])
  assertEquals(body.unassignedFortnightlyCents, 50_00)
})

Deno.test('shapePaySplit orders splits by name and keeps an emoji-only name whole', () => {
  const body = shapePaySplit(rows({
    accounts: [
      account({ id: 'a', name: 'Zed' }),
      account({ id: 'b', name: '🏠' }),
      account({ id: 'c', name: 'Alpha' }),
      account({ id: 'pay', name: 'Spending' }),
    ],
    budgetLines: [
      line({ id: '1', destination_account_id: 'a' }),
      line({ id: '2', destination_account_id: 'b' }),
      line({ id: '3', destination_account_id: 'c' }),
    ],
  }))

  assertEquals(body.splits.map((s) => s.name), ['🏠', 'Alpha', 'Zed'])
  assertEquals(body.totalCents, 600_00)
})

Deno.test('runPaySplit returns the shaped body for the resolved household', async () => {
  const deps: PaySplitDeps = {
    resolveHousehold: () => Promise.resolve({ householdId: 'h1' }),
    loadRows: (householdId) => {
      assertEquals(householdId, 'h1')
      return Promise.resolve(rows())
    },
  }

  const result = await runPaySplit(deps)

  assertEquals(result.status, 200)
  assertEquals((result.body as { totalCents: number }).totalCents, 200_00)
})

Deno.test('runPaySplit passes a resolve failure straight through', async () => {
  const result = await runPaySplit({
    resolveHousehold: () =>
      Promise.resolve({ error: { status: 404, message: 'No household membership for this user' } }),
    loadRows: () => Promise.reject(new Error('not reached')),
  })

  assertEquals(result, { status: 404, body: { error: 'No household membership for this user' } })
})
