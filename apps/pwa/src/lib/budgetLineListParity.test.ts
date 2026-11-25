import { describe, expect, it } from 'vitest'
import { BUDGET_GROUPS } from './budgetGroups'
import { budgetLineSearch, visibleBudgetLines, type BudgetLineSortKey } from './budgetLineSort'
import type { Tables } from './database.types'
import type { SortDirection } from './sort'

/**
 * The search and sort the native Budget screen is held to. The lines are written
 * in full, as PostgREST returns them; each case is what `BudgetLineList` lists for
 * a search and sort choice (`budgetLineSearch` and `visibleBudgetLines` per group,
 * a group with no match hidden while searching). The fixture is committed beside
 * the iOS tests (`vitest -u` rewrites it); `BudgetLineListParityTests` decodes the
 * same rows and must list identical groups and lines for every case.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/budget-line-list-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const line = (overrides: Partial<Tables<'budget_line'>>): Tables<'budget_line'> => ({
  ...base,
  id: 'b',
  starts_on: '2026-01-01',
  retired_on: null,
  name: 'Line',
  line_group: 'needs',
  amount_cents: 0,
  frequency: 'fortnightly',
  interval_count: null,
  allowance_member_id: null,
  breakdown_id: null,
  destination_account_id: null,
  gift_recipient_member_id: null,
  goal_id: null,
  is_gift_line: false,
  management_url: null,
  ...overrides,
})

const budgetLines = [
  line({ id: 'b1', name: 'Rent', amount_cents: 2_400_00, frequency: 'monthly' }),
  line({ id: 'b2', name: 'electricity', amount_cents: 600_00, frequency: 'quarterly' }),
  line({ id: 'b3', name: 'Groceries', amount_cents: 250_00, frequency: 'weekly' }),
  line({ id: 'b4', name: 'Énergie', amount_cents: 46_15 }),
  line({ id: 'b5', name: 'Streaming', line_group: 'wants', amount_cents: 25_00 }),
  line({
    id: 'b6',
    name: 'Gym',
    line_group: 'discretionary',
    amount_cents: 90_00,
    frequency: 'every_n_weeks',
    interval_count: 3,
  }),
  line({ id: 'b7', name: 'gym gear', line_group: 'discretionary', amount_cents: 60_00 }),
  line({ id: 'b8', name: 'Holiday', line_group: 'savings', amount_cents: 300_00 }),
]

const rows = {
  budgetLines,
  memberAllowances: [],
  members: [],
  accounts: [],
  savingsGoals: [],
  temporaryItems: [],
  breakdowns: [],
  superProfiles: [],
}

const listed = (query: string, key: BudgetLineSortKey, direction: SortDirection) => {
  const search = budgetLineSearch(query)
  return BUDGET_GROUPS.flatMap(({ value: group }) => {
    const ids = visibleBudgetLines(
      budgetLines.filter((row) => row.line_group === group),
      search,
      key,
      direction,
    ).map((row) => row.id)
    return search && ids.length === 0 ? [] : [{ group, ids }]
  })
}

const SORTS: [BudgetLineSortKey, SortDirection][] = [
  ['default', 'asc'],
  ['name', 'asc'],
  ['name', 'desc'],
  ['amount', 'asc'],
  ['amount', 'desc'],
]
const QUERIES = ['', '  GYM ', 'e', 'nothing']

const cases = QUERIES.flatMap((query) =>
  SORTS.map(([key, direction]) => ({
    query,
    key,
    direction,
    groups: listed(query, key, direction),
  })),
)

describe('budget line list parity fixture', () => {
  it('matches the committed rows and listings', async () => {
    await expect(JSON.stringify({ rows, cases }, null, 2) + '\n').toMatchFileSnapshot(FIXTURE)
  })

  it('orders by name ignoring case and by fortnightly amount, hiding unmatched groups', () => {
    expect(listed('', 'name', 'asc')[0]!.ids).toEqual(['b2', 'b4', 'b3', 'b1'])
    expect(listed('', 'amount', 'asc')[0]!.ids).toEqual(['b4', 'b2', 'b3', 'b1'])
    expect(listed('  GYM ', 'default', 'asc')).toEqual([
      { group: 'discretionary', ids: ['b6', 'b7'] },
    ])
    expect(listed('nothing', 'default', 'asc')).toEqual([])
  })
})
