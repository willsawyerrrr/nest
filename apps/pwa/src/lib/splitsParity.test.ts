import { describe, expect, it } from 'vitest'
import {
  assignmentsByAccount,
  isRecommendedSplitAccount,
  paySplitNeedsUpdate,
  roundCentsUpToStep,
} from '@nest/plan'
import { accountLabel } from './accountName'
import { toAssignableAllowances } from './allowances'
import type { Tables } from './database.types'
import { superAccountIds } from './super'

/**
 * The household the native Pay splits screen is held to. The rows are written in
 * full, as PostgREST returns them, and the figures are what the PWA's own Splits
 * code (`assignmentsByAccount`, `roundCentsUpToStep`, `isRecommendedSplitAccount`,
 * `paySplitNeedsUpdate`, as `SplitsScreen` uses them) produces from them. The
 * fixture is committed beside the iOS tests (`vitest -u` rewrites it);
 * `SplitsParityTests` assembles the engine input the screen does, runs the
 * bundled engine and the Swift presentation, and must return identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/splits-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }
const STEP = 5_00

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

const account = (
  id: string,
  name: string,
  overrides: Partial<Tables<'account_directory'>> = {},
): Tables<'account_directory'> => ({
  id,
  name,
  household_id: 'h1',
  deleted_from_source_at: null,
  owner_member_id: null,
  source: 'manual',
  type: 'transaction',
  ...overrides,
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

const goal = (id: string, name: string, linked: string | null): Tables<'savings_goal'> => ({
  ...base,
  id,
  name,
  target_amount_cents: 10_000_00,
  current_balance_cents: 0,
  annual_interest_bps: null,
  linked_account_id: linked,
  planned_contribution_cents: null,
  queue_position: null,
  target_date: null,
})

const rows = {
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
      destination_account_id: 'a2',
    }),
    line({
      id: 'b3',
      name: 'Holiday',
      line_group: 'savings',
      amount_cents: 301_37,
      frequency: 'fortnightly',
      goal_id: 'g1',
    }),
    line({
      id: 'b4',
      name: 'Shares',
      line_group: 'investments',
      amount_cents: 6_000_00,
      frequency: 'annual',
      goal_id: 'g2',
    }),
    line({
      id: 'b5',
      name: 'Coffee',
      line_group: 'discretionary',
      amount_cents: 40_00,
      allowance_member_id: 'm1',
    }),
    line({
      id: 'b6',
      name: 'Gym',
      line_group: 'discretionary',
      amount_cents: 90_00,
      frequency: 'every_n_weeks',
      interval_count: 3,
    }),
    line({
      id: 'b7',
      name: 'Car',
      amount_cents: 80_00,
      destination_account_id: 'a5',
    }),
  ],
  savingsGoals: [goal('g1', 'Japan', 'a3'), goal('g2', 'Shares', 'a3')],
  accounts: [
    account('a1', '🏠 Bills'),
    account('a2', 'Spending'),
    account('a3', '✈️ Japan', { source: 'up', type: 'savings' }),
    account('a4', 'Super', { source: 'up', type: 'savings' }),
    account('a5', 'Emergency', {
      source: 'up',
      type: 'savings',
      deleted_from_source_at: '2026-06-01T00:00:00Z',
    }),
  ],
  superProfiles: [
    {
      ...base,
      id: 'sp1',
      member_id: 'm1',
      financial_year: 2027,
      fund_name: null,
      linked_account_id: 'a4',
      balance_as_of: null,
      carry_forward_cap_cents: 0,
      sg_rate_override: null,
    },
  ],
  paySplits: [
    {
      ...base,
      id: 'ps1',
      account_id: 'a1',
      confirmed_fortnightly_cents: 1_110_00,
      confirmed_at: STAMP,
    },
    {
      ...base,
      id: 'ps2',
      account_id: 'a3',
      confirmed_fortnightly_cents: 200_00,
      confirmed_at: STAMP,
    },
  ],
  households: [
    {
      id: 'h1',
      name: 'Home',
      created_at: STAMP,
      updated_at: STAMP,
      invite_code: null,
      invite_code_expires_at: null,
      pay_account_id: 'a2' as string | null,
      timezone: 'Australia/Melbourne',
    },
  ],
  members: [member('m1', 'Ada'), member('m2', 'Ben')],
  memberAllowances: [
    {
      ...base,
      id: 'al1',
      member_id: 'm1',
      amount_cents: 150_00,
      frequency: 'fortnightly' as const,
      interval_count: null,
      destination_account_id: 'a2',
    },
    {
      ...base,
      id: 'al2',
      member_id: 'm2',
      amount_cents: 600_00,
      frequency: 'monthly' as const,
      interval_count: null,
      destination_account_id: 'a1',
    },
  ],
}

/** The Splits screen's figures for `payAccountId`, as `SplitsScreen` derives them. */
function figures(payAccountId: string | null) {
  const superIds = superAccountIds(rows.superProfiles)
  const accounts = rows.accounts.filter((entry) => !superIds.has(entry.id!))
  const { byAccount, linesByAccount, unassignedFortnightlyCents } = assignmentsByAccount(
    rows.budgetLines.map((entry) => ({
      id: entry.id,
      name: entry.name,
      group: entry.line_group,
      amountCents: entry.amount_cents,
      frequency: entry.frequency,
      ...(entry.interval_count != null && { interval: entry.interval_count }),
      goalId: entry.goal_id,
      destinationAccountId: entry.destination_account_id,
      allowanceMemberId: entry.allowance_member_id,
    })),
    rows.savingsGoals.map((entry) => ({ id: entry.id, linkedAccountId: entry.linked_account_id })),
    toAssignableAllowances(rows.memberAllowances, rows.members),
  )
  const configured = new Map(
    rows.paySplits.map((split) => [split.account_id, split.confirmed_fortnightly_cents]),
  )
  const byId = new Map(accounts.map((entry) => [entry.id!, entry]))
  const routed = Object.entries(byAccount)
    .filter(([id]) => byId.has(id))
    .map(([id, fortnightlyCents]) => ({ id, fortnightlyCents, account: byId.get(id)! }))
  const recommended = (row: (typeof routed)[number]) =>
    isRecommendedSplitAccount(
      {
        isPayAccount: row.id === payAccountId,
        isSaver: row.account.source !== 'manual' && row.account.type === 'savings',
      },
      payAccountId !== null,
    )
  const render = (row: (typeof routed)[number]) => {
    const roundedCents = roundCentsUpToStep(row.fortnightlyCents, STEP)
    const configuredCents = configured.get(row.id) ?? null
    return {
      accountId: row.id,
      label: accountLabel(row.account.name!),
      exactCents: row.fortnightlyCents,
      roundedCents,
      configuredCents,
      needsUpdate: paySplitNeedsUpdate(roundedCents, configuredCents),
      lines: linesByAccount[row.id] ?? [],
    }
  }
  const byTitle = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)
  return {
    payAccountId,
    routes: {
      accounts: Object.entries(byAccount).map(([accountId, fortnightlyCents]) => ({
        accountId,
        fortnightlyCents,
        lines: linesByAccount[accountId] ?? [],
      })),
      unassignedFortnightlyCents,
    },
    recommended: routed.filter(recommended).map(render).sort(byTitle),
    stays: routed
      .filter((row) => !recommended(row))
      .map(render)
      .sort(byTitle),
  }
}

const cases = [
  { name: 'a pay account is chosen', payAccountId: 'a2' },
  { name: 'no pay account is chosen', payAccountId: null },
].map(({ name, payAccountId }) => {
  const caseRows = { ...rows, households: [{ ...rows.households[0]!, pay_account_id: payAccountId }] }
  return { name, rows: caseRows, expected: JSON.parse(JSON.stringify(figures(payAccountId))) as unknown }
})

describe('the native Pay splits parity fixture', () => {
  it('matches what the PWA Splits screen computes from the same rows', async () => {
    await expect(`${JSON.stringify(cases, null, 2)}\n`).toMatchFileSnapshot(FIXTURE)
  })

  it('flags a drifted, a never-confirmed and a matching account', () => {
    const { recommended } = figures('a2')
    const flags = Object.fromEntries(recommended.map((row) => [row.label, row.needsUpdate]))
    expect(flags).toEqual({ Bills: false, Emergency: true, Japan: true })
  })

  it('recommends only savers while no pay account is chosen', () => {
    const { recommended, stays } = figures(null)
    expect(recommended.map((row) => row.label)).toEqual(['Emergency', 'Japan'])
    expect(stays.map((row) => row.label)).toEqual(['Bills', 'Spending'])
  })
})
