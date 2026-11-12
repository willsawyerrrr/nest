import { describe, expect, it } from 'vitest'
import { DEFAULT_ASSUMPTIONS, grantValueCents } from '@nest/plan'
import type { Tables } from './database.types'
import { equityGrantToPlan } from './equity'
import {
  computeNetWorth,
  projectionHorizonYears,
  resolveHorizonYears,
  type NetWorthComputeResult,
} from './netWorth'
import { netWorthBreakdown, superAccountIds, type EquityHolding, type Liability } from './super'
import { heldEquityHoldings } from './trades'

/**
 * The household the native Net worth screen is held to. The rows are written in
 * full, as PostgREST returns them, and the figures are what the PWA's own Net
 * worth tab (`NetWorthSection`) computes from them. The fixture is committed
 * beside the iOS tests (`vitest -u` rewrites it); `NetWorthParityTests` builds
 * the engine input the screen does, runs the bundled engine, and must return
 * identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/net-worth-parity.json'
const NOW = '2026-12-01T00:00:00Z'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string, dob: string | null): Tables<'members'> => ({
  ...base,
  id,
  name,
  date_of_birth: dob,
  email: null,
  up_connected_at: null,
  up_sync_failed_at: null,
  user_id: `u-${id}`,
})

const account = (
  id: string,
  name: string,
  type: Tables<'accounts_with_balance'>['type'],
  balance: number,
  overrides: Partial<Tables<'accounts_with_balance'>> = {},
): Tables<'accounts_with_balance'> => ({
  ...base,
  id,
  name,
  type,
  balance_cents: balance,
  currency: 'AUD',
  deleted_from_source_at: null,
  exclude_from_net_worth: false,
  external_id: null,
  owner_member_id: null,
  source: 'manual',
  ...overrides,
})

const inflow = (id: string, memberId: string, amount: number): Tables<'inflows'> => ({
  ...base,
  id,
  member_id: memberId,
  name: 'Salary',
  taxable: true,
  attracts_super: true,
  type: 'salary',
  schedule: 'annual',
  interval_count: null,
  pay_schedule: null,
  pay_interval_count: null,
  arrives_every_pay_period: true,
  amount_cents: amount,
  hourly_rate_cents: null,
  hours_per_period: null,
  starts_on: null,
  ends_on: null,
  pay_anchor_date: null,
  paid_on: null,
  one_off_tax_treatment: null,
  years_of_service: null,
  is_joint: false,
  member_split_percent: null,
})

const grant = (overrides: Partial<Tables<'equity_grant'>>): Tables<'equity_grant'> => ({
  ...base,
  id: 'eg1',
  member_id: 'm1',
  label: 'Startup options',
  instrument_type: 'option',
  quantity: 40_000,
  grant_date: '2024-07-01',
  cliff_months: 12,
  vesting_period_months: 48,
  vesting_frequency: 'monthly',
  strike_price_cents: 50,
  price_per_share_cents: 250,
  price_as_of: null,
  ...overrides,
})

const trade = (overrides: Partial<Tables<'trade'>>): Tables<'trade'> => ({
  ...base,
  id: 't1',
  member_id: 'm1',
  ticker: 'VAS',
  side: 'buy',
  traded_on: '2025-02-03',
  units: 120,
  price_per_unit_microdollars: 95_500_000,
  fee_cents: 995,
  source: 'manual',
  document_id: null,
  external_id: null,
  ...overrides,
})

const rows = {
  members: [member('m1', 'Ada', '1990-04-02'), member('m2', 'Ben', '1988-09-15')],
  accounts: [
    account('a1', 'Bills', 'transaction', 4_200_00),
    account('a2', 'Emergency', 'savings', 18_000_00, { source: 'up', external_id: 'up-1' }),
    account('a3', 'Ada Super', 'other', 92_000_00),
    account('a4', 'Ben Super', 'other', 61_500_00),
    account('a5', 'Home loan', 'home_loan', -410_000_00, { source: 'up', external_id: 'up-2' }),
    account('a6', 'Credit card', 'credit', -1_250_00),
    account('a7', 'Old savings', 'savings', 3_300_00, { exclude_from_net_worth: true }),
    account('a8', 'Gone account', 'savings', 600_00, {
      source: 'up',
      external_id: 'up-3',
      deleted_from_source_at: '2026-10-01T00:00:00Z',
    }),
  ],
  superProfiles: [
    {
      ...base,
      id: 'sp1',
      member_id: 'm1',
      financial_year: 2027,
      fund_name: 'Aus Super',
      linked_account_id: 'a3',
      balance_as_of: '2026-07-01',
      carry_forward_cap_cents: 0,
      sg_rate_override: null,
    },
    {
      ...base,
      id: 'sp2',
      member_id: 'm2',
      financial_year: 2027,
      fund_name: null,
      linked_account_id: 'a4',
      balance_as_of: null,
      carry_forward_cap_cents: 0,
      sg_rate_override: null,
    },
  ],
  contributions: [
    {
      ...base,
      id: 'sc1',
      member_id: 'm1',
      financial_year: 2027,
      kind: 'salary_sacrifice' as const,
      mode: 'amount' as const,
      amount_cents: 300_00,
      percent_bp: null,
      frequency: 'monthly' as const,
      interval_count: null,
      fhss_eligible: false,
      contributor_member_id: null,
    },
  ],
  taxProfiles: [
    {
      ...base,
      id: 'tp1',
      member_id: 'm1',
      financial_year: 2027,
      residency: 'resident' as const,
      has_private_hospital_cover: true,
    },
    {
      ...base,
      id: 'tp2',
      member_id: 'm2',
      financial_year: 2027,
      residency: 'resident' as const,
      has_private_hospital_cover: false,
    },
  ],
  helpDebts: [{ ...base, id: 'hd1', member_id: 'm2', balance_cents: 21_400_00 }],
  deductions: [] as Tables<'deduction'>[],
  inflows: [inflow('i1', 'm1', 130_000_00), inflow('i2', 'm2', 95_000_00)],
  savingsGoals: [
    {
      ...base,
      id: 'g1',
      name: 'Holiday',
      target_amount_cents: 12_000_00,
      current_balance_cents: 2_000_00,
      annual_interest_bps: null,
      linked_account_id: null,
      planned_contribution_cents: null,
      queue_position: null,
      target_date: null,
    },
    {
      ...base,
      id: 'g2',
      name: 'Rainy day',
      target_amount_cents: 25_000_00,
      current_balance_cents: 0,
      annual_interest_bps: null,
      linked_account_id: 'a2',
      planned_contribution_cents: null,
      queue_position: 0,
      target_date: null,
    },
  ],
  budgetLines: [
    {
      ...base,
      id: 'b1',
      name: 'Holiday fund',
      line_group: 'savings' as const,
      amount_cents: 250_00,
      frequency: 'fortnightly' as const,
      interval_count: null,
      allowance_member_id: null,
      breakdown_id: null,
      destination_account_id: null,
      gift_recipient_member_id: null,
      goal_id: 'g1',
      is_gift_line: false,
      management_url: null,
    },
  ],
  equityGrants: [
    grant({}),
    grant({
      id: 'eg2',
      member_id: 'm2',
      label: 'Granted shares',
      instrument_type: 'share',
      quantity: 10_000,
      strike_price_cents: null,
      price_per_share_cents: 180,
    }),
  ],
  equityExercises: [
    {
      ...base,
      id: 'ex1',
      grant_id: 'eg1',
      member_id: 'm1',
      exercised_on: '2026-03-01',
      quantity: 5_000,
      strike_price_cents: 50,
      market_price_per_share_cents: 200,
    },
  ],
  equitySales: [
    {
      ...base,
      id: 'es1',
      grant_id: 'eg1',
      member_id: 'm1',
      sold_on: '2026-06-01',
      quantity: 1_000,
      price_per_share_cents: 220,
      fee_cents: 0,
    },
  ],
  trades: [
    trade({}),
    trade({
      id: 't2',
      member_id: 'm2',
      ticker: 'NDQ',
      units: 40,
      price_per_unit_microdollars: 48_250_000,
    }),
    trade({
      id: 't3',
      side: 'sell',
      traded_on: '2026-05-01',
      units: 20,
      price_per_unit_microdollars: 101_000_000,
    }),
  ],
}

/** The Net worth tab's own composition, as `NetWorthSection` assembles it. */
function pwaOutcome(horizon: '5y' | '10y' | '20y' | '30y' | 'retirement') {
  const today = new Date(NOW)
  const members = rows.members
  const liabilities: Liability[] = rows.helpDebts
    .filter((debt) => debt.balance_cents > 0)
    .map((debt) => ({
      label: `${members.find((m) => m.id === debt.member_id)?.name}'s HELP debt`,
      balanceCents: debt.balance_cents,
    }))
  const toPlanGrant = (g: Tables<'equity_grant'>) =>
    equityGrantToPlan(g, rows.equityExercises, rows.equitySales)
  const heldEquity = heldEquityHoldings(rows.trades, members)
  const equity: EquityHolding[] = [
    ...rows.equityGrants
      .map((g) => ({
        label: `${members.find((m) => m.id === g.member_id)?.name} — ${g.label}`,
        valueCents: grantValueCents(toPlanGrant(g), today),
      }))
      .filter((holding) => holding.valueCents > 0),
    ...heldEquity,
  ]
  const horizonYears = resolveHorizonYears(
    horizon,
    projectionHorizonYears([], DEFAULT_ASSUMPTIONS.retirementAge),
  )
  const outcome: NetWorthComputeResult = computeNetWorth({
    accounts: rows.accounts as never,
    superProfiles: rows.superProfiles,
    contributions: rows.contributions,
    taxProfiles: rows.taxProfiles,
    helpDebts: rows.helpDebts,
    deductions: rows.deductions,
    members,
    planGrants: rows.equityGrants.map(toPlanGrant),
    liabilities,
    equity,
    heldEquityCents: heldEquity.reduce((total, h) => total + h.valueCents, 0),
    inflows: rows.inflows,
    goals: rows.savingsGoals,
    budgetLines: rows.budgetLines,
    assumptions: DEFAULT_ASSUMPTIONS,
    horizonYears,
    now: today,
  })
  return {
    breakdown: netWorthBreakdown(
      outcome.effectiveAccounts,
      superAccountIds(rows.superProfiles),
      liabilities,
      equity,
    ),
    projection: outcome.projection,
    projectionBaseYear: today.getFullYear(),
  }
}

const cases = (['10y', 'retirement'] as const).map((horizon) => ({
  name: `a two-member household, ${horizon}`,
  now: NOW,
  horizon,
  rows,
  expected: JSON.parse(JSON.stringify(pwaOutcome(horizon))) as unknown,
}))

describe('the native Net worth parity fixture', () => {
  it('matches what the PWA Net worth tab computes from the same rows', async () => {
    await expect(`${JSON.stringify(cases, null, 2)}\n`).toMatchFileSnapshot(FIXTURE)
  })

  it('shows every kind of holding', () => {
    const { breakdown } = pwaOutcome('10y')
    expect(breakdown.equityHoldings.length).toBeGreaterThan(2)
    expect(breakdown.liabilities.map((l) => l.label)).toContain('Home loan')
    expect(breakdown.excludedAccounts.map((a) => a.id)).toEqual(['a7'])
  })
})
