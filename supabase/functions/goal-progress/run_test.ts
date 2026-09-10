import { assertEquals } from '@std/assert'
import {
  type GoalProgressDeps,
  type GoalRow,
  runGoalProgress,
  type SaverBalanceRow,
  shapeGoalProgress,
} from './run.ts'

function goal(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    name: 'Goal',
    target_amount_cents: 10_000_00,
    current_balance_cents: 0,
    target_date: null,
    linked_account_id: null,
    ...overrides,
  }
}

Deno.test('shapeGoalProgress uses the manual balance when a goal links no saver', () => {
  const body = shapeGoalProgress([goal({ name: 'Rainy day', current_balance_cents: 2_500_00 })], [])

  assertEquals(body.goals, [{ name: 'Rainy day', savedCents: 2_500_00, targetCents: 10_000_00 }])
  assertEquals(body.totalSavedCents, 2_500_00)
  assertEquals(body.totalTargetCents, 10_000_00)
})

Deno.test('shapeGoalProgress takes a linked saver balance over the manual figure', () => {
  const savers: SaverBalanceRow[] = [{ id: 'saver-1', balance_cents: 7_200_00 }]
  const body = shapeGoalProgress(
    [goal({ name: 'Japan', current_balance_cents: 100_00, linked_account_id: 'saver-1' })],
    savers,
  )

  assertEquals(body.goals[0]?.savedCents, 7_200_00)
})

Deno.test('shapeGoalProgress falls back to the manual figure when the linked saver is gone', () => {
  const body = shapeGoalProgress(
    [goal({ current_balance_cents: 300_00, linked_account_id: 'missing' })],
    [{ id: 'saver-1', balance_cents: 9_999_00 }],
  )

  assertEquals(body.goals[0]?.savedCents, 300_00)
})

Deno.test('shapeGoalProgress puts dated goals first by date, then undated by name', () => {
  const body = shapeGoalProgress(
    [
      goal({ name: 'Zeta', target_date: null }),
      goal({ name: 'Alpha', target_date: null }),
      goal({ name: 'House', target_date: '2028-01-01' }),
      goal({ name: 'Car', target_date: '2027-03-01' }),
    ],
    [],
  )

  assertEquals(
    body.goals.map((entry) => entry.name),
    ['Car', 'House', 'Alpha', 'Zeta'],
  )
})

Deno.test('shapeGoalProgress sums every goal into the totals', () => {
  const body = shapeGoalProgress(
    [
      goal({ current_balance_cents: 1_000_00, target_amount_cents: 5_000_00 }),
      goal({ current_balance_cents: 4_000_00, target_amount_cents: 20_000_00 }),
    ],
    [],
  )

  assertEquals(body.totalSavedCents, 5_000_00)
  assertEquals(body.totalTargetCents, 25_000_00)
})

Deno.test('shapeGoalProgress returns zeroed totals for a household with no goals', () => {
  assertEquals(shapeGoalProgress([], []), {
    goals: [],
    totalSavedCents: 0,
    totalTargetCents: 0,
  })
})

function deps(overrides: Partial<GoalProgressDeps> = {}): GoalProgressDeps {
  return {
    resolveHousehold: () => Promise.resolve({ householdId: 'h1' }),
    loadGoalsAndSavers: () =>
      Promise.resolve({
        goals: [goal({ name: 'Emergency fund', current_balance_cents: 3_000_00 })],
        savers: [],
      }),
    ...overrides,
  }
}

Deno.test('runGoalProgress returns the shaped body for the resolved household', async () => {
  const result = await runGoalProgress(deps())

  assertEquals(result, {
    status: 200,
    body: {
      goals: [{ name: 'Emergency fund', savedCents: 3_000_00, targetCents: 10_000_00 }],
      totalSavedCents: 3_000_00,
      totalTargetCents: 10_000_00,
    },
  })
})

Deno.test('runGoalProgress passes a resolve failure straight through', async () => {
  const result = await runGoalProgress(
    deps({
      resolveHousehold: () =>
        Promise.resolve({
          error: { status: 404, message: 'No household membership for this user' },
        }),
    }),
  )

  assertEquals(result, {
    status: 404,
    body: { error: 'No household membership for this user' },
  })
})
