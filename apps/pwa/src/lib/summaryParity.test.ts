import { describe, expect, it } from 'vitest'
import { derivedAmountContext } from './breakdowns'
import type { Tables } from './database.types'
import { summariseHousehold } from './summary'

/**
 * The household the native Summary screen is held to. The rows are written in
 * full, as PostgREST returns them, and the figures are what the PWA's own
 * `summariseHousehold` produces from them. The fixture is committed beside the
 * iOS tests (`vitest -u` rewrites it), which decode the same rows, assemble the engine input the screen
 * does, run the bundled engine, and must return identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/summary-parity.json'
const NOW = '2026-12-01T00:00:00Z'
const STAMP = '2026-01-01T00:00:00Z'
const HOUSEHOLD = 'h1'

const base = { household_id: HOUSEHOLD, created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string, date_of_birth: string | null): Tables<'members'> => ({
  ...base,
  id,
  name,
  date_of_birth,
  email: null,
  up_connected_at: null,
  up_sync_failed_at: null,
  user_id: `u-${id}`,
})

const inflow = (overrides: Partial<Tables<'inflows'>>): Tables<'inflows'> => ({
  ...base,
  id: 'i',
  name: 'Inflow',
  type: 'salary',
  member_id: 'm1',
  taxable: true,
  attracts_super: true,
  schedule: 'annual',
  amount_cents: null,
  interval_count: null,
  hourly_rate_cents: null,
  hours_per_period: null,
  starts_on: null,
  ends_on: null,
  paid_on: null,
  pay_anchor_date: null,
  pay_interval_count: null,
  pay_schedule: null,
  arrives_every_pay_period: false,
  one_off_tax_treatment: null,
  years_of_service: null,
  is_joint: false,
  member_split_percent: null,
  ...overrides,
})

const budgetLine = (overrides: Partial<Tables<'budget_line'>>): Tables<'budget_line'> => ({
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

const breakdown: Tables<'breakdown'> = {
  ...base,
  id: 'bd1',
  name: 'Utilities',
  kind: 'generic',
  line_group: 'needs',
}
const breakdownItems = [
  breakdownItem('power', 300_00, 'monthly'),
  breakdownItem('water', 400_00, 'quarterly'),
]
// 300 × 12 + 400 × 4: the roll-up the database keeps canonical on the derived line.
const UTILITIES_ANNUAL_CENTS = 5_200_00

const members = [member('m1', 'Ada', '1990-04-02'), member('m2', 'Ben', '1988-09-20')]

const saver: Tables<'accounts_with_balance'> = {
  ...base,
  id: 'a1',
  name: 'Saver',
  currency: 'AUD',
  deleted_from_source_at: null,
  exclude_from_net_worth: false,
  external_id: 'up-1',
  owner_member_id: 'm1',
  source: 'up',
  type: 'savings',
  balance_cents: 12_000_00,
}

const rows = {
  inflows: [
    inflow({ id: 'i1', name: 'Ada salary', amount_cents: 150_000_00 }),
    inflow({
      id: 'i2',
      name: 'Ben wage',
      member_id: 'm2',
      type: 'wage',
      schedule: 'fortnightly',
      amount_cents: null,
      hourly_rate_cents: 55_00,
      hours_per_period: 76,
    }),
    inflow({
      id: 'i3',
      name: 'Bonus',
      type: 'other',
      schedule: null,
      amount_cents: 8_000_00,
      paid_on: '2026-10-15',
      attracts_super: false,
    }),
  ],
  taxProfiles: [
    {
      ...base,
      id: 't1',
      member_id: 'm1',
      financial_year: 2027,
      residency: 'resident' as const,
      has_private_hospital_cover: true,
    },
    {
      ...base,
      id: 't2',
      member_id: 'm2',
      financial_year: 2027,
      residency: 'resident' as const,
      has_private_hospital_cover: false,
    },
  ],
  contributions: [
    {
      ...base,
      id: 'c1',
      member_id: 'm1',
      contributor_member_id: null,
      financial_year: 2027,
      kind: 'salary_sacrifice' as const,
      mode: 'amount' as const,
      amount_cents: 200_00,
      percent_bp: null,
      frequency: 'fortnightly' as const,
      interval_count: null,
      fhss_eligible: false,
    },
  ],
  helpDebts: [{ ...base, id: 'd1', member_id: 'm2', balance_cents: 18_000_00 }],
  deductions: [
    {
      ...base,
      id: 'x1',
      member_id: 'm1',
      financial_year: 2027,
      deduction_date: '2026-08-01',
      description: 'Laptop',
      category: 'work_expense' as const,
      basis: 'amount' as const,
      amount_cents: 900_00,
      full_amount_cents: 1_500_00,
      work_use_percent: 60,
      distance_km: null,
      work_from_home_hours: null,
      group_id: null,
    },
  ],
  members,
  budgetLines: [
    budgetLine({ id: 'b1', name: 'Rent', amount_cents: 2_400_00, frequency: 'monthly' }),
    budgetLine({
      id: 'b2',
      name: 'Utilities',
      amount_cents: UTILITIES_ANNUAL_CENTS,
      frequency: 'annual',
      breakdown_id: 'bd1',
    }),
    budgetLine({
      id: 'b3',
      name: 'Streaming',
      line_group: 'wants',
      amount_cents: 25_00,
      frequency: 'weekly',
    }),
    budgetLine({
      id: 'b4',
      name: 'Coffee',
      line_group: 'discretionary',
      amount_cents: 40_00,
      frequency: 'fortnightly',
      allowance_member_id: 'm1',
    }),
    budgetLine({
      id: 'b5',
      name: 'Holiday',
      line_group: 'savings',
      amount_cents: 300_00,
      frequency: 'fortnightly',
      goal_id: 'g1',
    }),
    budgetLine({
      id: 'b6',
      name: 'Shares',
      line_group: 'investments',
      amount_cents: 500_00,
      frequency: 'monthly',
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
  ],
  temporaryItems: [
    { ...base, id: 'tmp1', name: 'Course', contribution_cents: 80_00, target_date: '2027-03-31' },
  ],
  savingsGoals: [
    {
      ...base,
      id: 'g1',
      name: 'Holiday',
      target_amount_cents: 15_000_00,
      current_balance_cents: 3_000_00,
      annual_interest_bps: 480,
      linked_account_id: 'a1',
      planned_contribution_cents: null,
      queue_position: null,
      target_date: '2027-12-31',
    },
  ],
  savers: [saver],
}

const expected = JSON.parse(
  JSON.stringify(
    summariseHousehold({
      inflows: rows.inflows,
      budgetLines: rows.budgetLines,
      memberAllowances: rows.memberAllowances,
      taxProfiles: rows.taxProfiles,
      contributions: rows.contributions,
      helpDebts: rows.helpDebts,
      deductions: rows.deductions,
      members: rows.members,
      goals: rows.savingsGoals,
      accounts: rows.savers.map((account) => ({
        id: account.id ?? '',
        balance_cents: account.balance_cents ?? 0,
        owner_member_id: account.owner_member_id,
      })),
      derivedAmounts: derivedAmountContext([breakdown], breakdownItems, [], [], null),
      temporaryItems: rows.temporaryItems,
      now: new Date(NOW),
    }),
  ),
) as unknown

describe('the native Summary parity fixture', () => {
  const text = `${JSON.stringify([{ name: 'a two-member household', now: NOW, rows, expected }], null, 2)}\n`

  it('matches what the PWA Summary computes from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises derived lines, an allowance, a one-off and a saver-linked goal', () => {
    expect(expected).toMatchObject({ oneOffCents: expect.any(Number) })
    const summary = expected as { oneOffCents: number; allowances: unknown[] }
    expect(summary.oneOffCents).toBeGreaterThan(0)
    expect(summary.allowances).toHaveLength(1)
  })
})
