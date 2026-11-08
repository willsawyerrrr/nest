import { describe, expect, it } from 'vitest'
import { budgetOverview, isTemporaryActive } from '@nest/plan'
import { toPlanAllowance, toPlanBudgetLine } from './allowances'
import type { Tables } from './database.types'
import { summariseHousehold } from './summary'

/**
 * The household the native Budget and Allowance screens are held to. The rows
 * are written in full, as PostgREST returns them, and the figures are what the
 * PWA's own Budget code (`budgetOverview`, as `BudgetLineList` uses it) produces
 * from them. The fixture is committed beside the iOS tests (`vitest -u` rewrites
 * it); `BudgetParityTests` assembles the engine input the screen does, runs the
 * bundled engine, and must return identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/budget-parity.json'
const NOW = '2026-12-01T00:00:00Z'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string): Tables<'members'> => ({
  ...base,
  id,
  name,
  date_of_birth: null,
  email: null,
  up_connected_at: null,
  up_sync_failed_at: null,
  user_id: `u-${id}`,
})

const account = (id: string, name: string): Tables<'accounts'> => ({
  ...base,
  id,
  name,
  currency: 'AUD',
  deleted_from_source_at: null,
  exclude_from_net_worth: false,
  external_id: null,
  owner_member_id: null,
  source: 'manual',
  type: 'transaction',
})

const line = (overrides: Partial<Tables<'budget_line'>>): Tables<'budget_line'> => ({
  ...base,
  id: 'b',
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

const rows = {
  members: [member('m1', 'Ada'), member('m2', 'Ben')],
  accounts: [account('a1', 'Bills'), account('a2', 'Spending')],
  budgetLines: [
    line({
      id: 'b1',
      name: 'Rent',
      amount_cents: 2_400_00,
      frequency: 'monthly',
      destination_account_id: 'a1',
    }),
    line({
      id: 'b2',
      name: 'Streaming',
      line_group: 'wants',
      amount_cents: 25_00,
      frequency: 'weekly',
    }),
    line({
      id: 'b3',
      name: 'Gym',
      line_group: 'discretionary',
      amount_cents: 90_00,
      frequency: 'every_n_weeks',
      interval_count: 3,
      destination_account_id: 'a2',
    }),
    line({
      id: 'b4',
      name: 'Coffee',
      line_group: 'discretionary',
      amount_cents: 40_00,
      frequency: 'fortnightly',
      allowance_member_id: 'm1',
    }),
    line({
      id: 'b5',
      name: 'Holiday',
      line_group: 'savings',
      amount_cents: 300_00,
      frequency: 'fortnightly',
      goal_id: 'g1',
    }),
    line({
      id: 'b6',
      name: 'Shares',
      line_group: 'investments',
      amount_cents: 6_000_00,
      frequency: 'annual',
    }),
  ],
  memberAllowances: [
    {
      ...base,
      id: 'al1',
      member_id: 'm1',
      amount_cents: 150_00,
      frequency: 'fortnightly' as const,
      interval_count: null,
      destination_account_id: null,
    },
    {
      ...base,
      id: 'al2',
      member_id: 'm2',
      amount_cents: 600_00,
      frequency: 'monthly' as const,
      interval_count: null,
      destination_account_id: 'a2',
    },
  ],
  temporaryItems: [
    { ...base, id: 't1', name: 'Course', contribution_cents: 80_00, target_date: '2027-03-31' },
    { ...base, id: 't2', name: 'Old', contribution_cents: 25_00, target_date: '2026-01-31' },
  ],
  savingsGoals: [
    {
      ...base,
      id: 'g1',
      name: 'Holiday',
      target_amount_cents: 15_000_00,
      current_balance_cents: 3_000_00,
      annual_interest_bps: null,
      linked_account_id: null,
      planned_contribution_cents: null,
      queue_position: null,
      target_date: null,
    },
  ],
}

const overview = budgetOverview(
  rows.budgetLines.map(toPlanBudgetLine),
  rows.memberAllowances.map(toPlanAllowance),
)

const expected = JSON.parse(
  JSON.stringify({
    ...overview,
    temporaryActive: rows.temporaryItems.map((item) =>
      isTemporaryActive(
        { contributionCents: item.contribution_cents, targetDate: item.target_date },
        new Date(NOW),
      ),
    ),
  }),
) as unknown

describe('the native Budget parity fixture', () => {
  const text = `${JSON.stringify([{ name: 'a two-member household', now: NOW, rows, expected }], null, 2)}\n`

  it('matches what the PWA Budget computes from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('agrees with the Summary on every group', () => {
    const summary = summariseHousehold({
      inflows: [],
      budgetLines: rows.budgetLines,
      memberAllowances: rows.memberAllowances,
      taxProfiles: [],
      contributions: [],
      helpDebts: [],
      deductions: [],
      members: rows.members,
      goals: rows.savingsGoals,
      accounts: [],
      derivedAmounts: new Map(),
      temporaryItems: [],
      now: new Date(NOW),
    })
    for (const group of ['needs', 'wants', 'discretionary', 'savings', 'investments'] as const) {
      expect(overview.groups[group]).toBe(summary.groups[group].fortnightlyCents)
    }
  })
})
