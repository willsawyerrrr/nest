import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { derivedAmountContext } from './breakdowns'
import type { Tables } from './database.types'
import { applyOverrides, type PlanningState } from './planningMode'
import { summariseHousehold } from './summary'

/**
 * The sandbox the native planning mode is held to. The household is the Summary
 * parity fixture's; the sandbox edits an inflow, hides one, edits and hides budget
 * lines, adds one, and edits a goal. The figures are what the PWA's own
 * `applyOverrides` and `summariseHousehold` produce for the real rows (baseline)
 * and the sandboxed rows (proposed). The fixture is committed beside the iOS tests
 * (`vitest -u` rewrites it); they apply the same sandbox with the native layer,
 * run the bundled engine and must return identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/planning-parity.json'
const SUMMARY_FIXTURE = '../../../ios/NestTests/Fixtures/summary-parity.json'

interface SummaryRows {
  inflows: Tables<'inflows'>[]
  taxProfiles: Tables<'tax_profile'>[]
  contributions: Tables<'super_contribution'>[]
  helpDebts: Tables<'help_debt'>[]
  deductions: Tables<'deduction'>[]
  members: Tables<'members'>[]
  budgetLines: Tables<'budget_line'>[]
  memberAllowances: Tables<'member_allowance'>[]
  temporaryItems: Tables<'temporary_item'>[]
  savingsGoals: Tables<'savings_goal'>[]
  savers: Tables<'accounts_with_balance'>[]
}

const [summary] = JSON.parse(
  readFileSync(fileURLToPath(new URL(SUMMARY_FIXTURE, import.meta.url)), 'utf8'),
) as [{ now: string; rows: SummaryRows }]
const { now, rows } = summary

const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }
// The breakdown behind the utilities line: the roll-up the database keeps canonical on it.
const breakdown: Tables<'breakdown'> = {
  ...base,
  id: 'bd1',
  name: 'Utilities',
  kind: 'generic',
  line_group: 'needs',
}
const breakdownItem = (
  id: string,
  amount_cents: number,
  frequency: Tables<'breakdown_item'>['frequency'],
): Tables<'breakdown_item'> => ({
  ...base,
  id,
  breakdown_id: 'bd1',
  name: id,
  amount_cents,
  frequency,
  interval_count: null,
})
const breakdownItems = [
  breakdownItem('power', 300_00, 'monthly'),
  breakdownItem('water', 400_00, 'quarterly'),
]

const state: PlanningState = {
  active: true,
  overrides: {
    inflows: {
      updates: { i1: { amount_cents: 180_000_00 } },
      creates: [],
      deletes: ['i3'],
    },
    budget_line: {
      updates: { b1: { amount_cents: 2_600_00 }, b3: { line_group: 'discretionary' } },
      creates: [
        {
          ...base,
          id: 'new1',
          name: 'Gym',
          line_group: 'wants',
          amount_cents: 60_00,
          frequency: 'fortnightly',
          interval_count: null,
          allowance_member_id: null,
          breakdown_id: null,
          destination_account_id: null,
          gift_recipient_member_id: null,
          goal_id: null,
          is_gift_line: false,
          management_url: null,
        },
      ],
      deletes: ['b6'],
    },
    savings_goal: {
      updates: { g1: { target_amount_cents: 20_000_00 } },
      creates: [],
      deletes: [],
    },
  },
}

const summarise = (
  inflows: Tables<'inflows'>[],
  budgetLines: Tables<'budget_line'>[],
  goals: Tables<'savings_goal'>[],
) =>
  JSON.parse(
    JSON.stringify(
      summariseHousehold({
        inflows,
        budgetLines,
        memberAllowances: rows.memberAllowances,
        taxProfiles: rows.taxProfiles,
        contributions: rows.contributions,
        helpDebts: rows.helpDebts,
        deductions: rows.deductions,
        members: rows.members,
        goals,
        accounts: rows.savers.map((account) => ({
          id: account.id ?? '',
          balance_cents: account.balance_cents ?? 0,
          owner_member_id: account.owner_member_id,
        })),
        derivedAmounts: derivedAmountContext([breakdown], breakdownItems, [], [], null),
        temporaryItems: rows.temporaryItems,
        now: new Date(now),
      }),
    ),
  ) as unknown

const expectedBaseline = summarise(rows.inflows, rows.budgetLines, rows.savingsGoals)
const expectedProposed = summarise(
  applyOverrides(rows.inflows, state.overrides.inflows),
  applyOverrides(rows.budgetLines, state.overrides.budget_line),
  applyOverrides(rows.savingsGoals, state.overrides.savings_goal),
)

describe('the native planning mode parity fixture', () => {
  const text = `${JSON.stringify(
    [
      {
        name: 'a sandboxed two-member household',
        now,
        rows,
        state,
        expectedBaseline,
        expectedProposed,
      },
    ],
    null,
    2,
  )}\n`

  it('matches what the PWA computes from the real and the sandboxed rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('moves the figures', () => {
    expect(expectedProposed).not.toEqual(expectedBaseline)
  })
})
