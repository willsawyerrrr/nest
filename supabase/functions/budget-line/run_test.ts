import { assertEquals } from '@std/assert'
import {
  type BudgetLineDeps,
  type BudgetLineRow,
  matchBudgetLine,
  runBudgetLine,
  shapeBudgetLine,
} from './run.ts'

function line(overrides: Partial<BudgetLineRow> = {}): BudgetLineRow {
  return {
    id: 'l1',
    name: 'Groceries',
    amount_cents: 200_00,
    frequency: 'weekly',
    interval_count: null,
    ...overrides,
  }
}

Deno.test('matchBudgetLine takes an exact name match, ignoring case and spacing', () => {
  const lines = [line({ name: 'Groceries' }), line({ name: 'Rent' })]

  assertEquals(matchBudgetLine(lines, '  GROCERIES ')?.name, 'Groceries')
})

Deno.test('matchBudgetLine falls back to the shortest containing name', () => {
  const lines = [
    line({ name: 'Rent & rates' }),
    line({ name: 'Rent' }),
    line({ name: 'Car rental' }),
  ]

  assertEquals(matchBudgetLine(lines, 'rent')?.name, 'Rent')
})

Deno.test('matchBudgetLine matches when the line name is contained by the query', () => {
  assertEquals(matchBudgetLine([line({ name: 'Gym' })], 'my gym membership')?.name, 'Gym')
})

Deno.test('matchBudgetLine returns null for an empty query or no lines', () => {
  assertEquals(matchBudgetLine([line()], '   '), null)
  assertEquals(matchBudgetLine([], 'groceries'), null)
})

Deno.test('shapeBudgetLine normalises the matched amount to fortnightly and annual', () => {
  const body = shapeBudgetLine([
    line({ name: 'Groceries', amount_cents: 200_00, frequency: 'weekly' }),
  ], 'groceries')

  assertEquals(body.match, {
    id: 'l1',
    name: 'Groceries',
    amountCents: 200_00,
    frequency: 'weekly',
    intervalCount: null,
    fortnightlyCents: 400_00,
    annualCents: 10_400_00,
  })
})

Deno.test('shapeBudgetLine carries an every-N-weeks interval through the normalisation', () => {
  const body = shapeBudgetLine(
    [line({
      name: 'Car service',
      amount_cents: 300_00,
      frequency: 'every_n_weeks',
      interval_count: 26,
    })],
    'car service',
  )

  assertEquals(body.match?.intervalCount, 26)
  assertEquals(body.match?.annualCents, 600_00)
})

Deno.test('shapeBudgetLine returns a null match with every sorted name when nothing matches', () => {
  const body = shapeBudgetLine([line({ name: 'Rent' }), line({ name: 'Groceries' })], 'holidays')

  assertEquals(body.match, null)
  assertEquals(body.names, ['Groceries', 'Rent'])
})

Deno.test('shapeBudgetLine lists every line with its amounts, sorted by name', () => {
  const body = shapeBudgetLine(
    [
      line({ id: 'l2', name: 'Rent', amount_cents: 1_400_00, frequency: 'fortnightly' }),
      line({ id: 'l1', name: 'Groceries', amount_cents: 200_00, frequency: 'weekly' }),
    ],
    '',
  )

  assertEquals(body.match, null)
  assertEquals(body.lines.map((l) => [l.id, l.name, l.fortnightlyCents]), [
    ['l1', 'Groceries', 400_00],
    ['l2', 'Rent', 1_400_00],
  ])
})

function deps(overrides: Partial<BudgetLineDeps> = {}): BudgetLineDeps {
  return {
    query: 'groceries',
    resolveHousehold: () => Promise.resolve({ householdId: 'h1', memberId: 'm1' }),
    loadBudgetLines: () => Promise.resolve([line({ name: 'Groceries' })]),
    ...overrides,
  }
}

Deno.test('runBudgetLine returns the shaped body for the resolved household', async () => {
  const result = await runBudgetLine(deps())

  assertEquals(result.status, 200)
  assertEquals((result.body as { match: { name: string } }).match.name, 'Groceries')
})

Deno.test('runBudgetLine passes a resolve failure straight through', async () => {
  const result = await runBudgetLine(
    deps({
      resolveHousehold: () =>
        Promise.resolve({ error: { status: 401, message: 'Invalid authorization' } }),
    }),
  )

  assertEquals(result, { status: 401, body: { error: 'Invalid authorization' } })
})

Deno.test('runBudgetLine hides lines drawn from a co-member’s allowance, matching and naming', async () => {
  const result = await runBudgetLine(
    deps({
      query: 'gym',
      loadBudgetLines: () =>
        Promise.resolve([
          line({ name: 'Gym', allowance_member_id: 'm2' }),
          line({ name: 'Coffee', allowance_member_id: 'm1' }),
          line({ name: 'Rent' }),
        ]),
    }),
  )

  assertEquals(result.body, { match: null, names: ['Coffee', 'Rent'] })
})
