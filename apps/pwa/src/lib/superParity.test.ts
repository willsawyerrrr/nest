import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accruedBalanceCents,
  DEFAULT_ASSUMPTIONS,
  projectSuperBalance,
  toProjectionInput,
  yearsToRetirement,
  type RetirementAssumptions,
} from '@nest/plan'
import type { Tables } from './database.types'
import {
  currentTaxConfig,
  netAnnualSuperContributionFromRows,
  superCapSummaryFromRows,
} from './tax'

/**
 * The households the native Super screen is held to. The rows are written in full,
 * as PostgREST returns them, and the figures are what the PWA computes from them
 * as `SuperSection` and `RetirementProjection` do: each member's cap summary, net
 * annual contribution, effective balance and projection. The fixture is committed
 * beside the iOS tests (`vitest -u` rewrites it); `SuperParityTests` decodes the
 * same rows, runs the bundled engine and must return identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/super-parity.json'
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

const contribution = (
  overrides: Partial<Tables<'super_contribution'>>,
): Tables<'super_contribution'> => ({
  ...base,
  id: 'c',
  member_id: 'm1',
  financial_year: 2027,
  kind: 'salary_sacrifice',
  mode: 'amount',
  amount_cents: null,
  percent_bp: null,
  frequency: 'annual',
  interval_count: null,
  fhss_eligible: false,
  contributor_member_id: null,
  ...overrides,
})

const profile = (overrides: Partial<Tables<'super_profile'>>): Tables<'super_profile'> => ({
  ...base,
  id: 'p',
  member_id: 'm1',
  financial_year: 2027,
  fund_name: null,
  linked_account_id: null,
  balance_as_of: null,
  carry_forward_cap_cents: 0,
  sg_rate_override: null,
  ...overrides,
})

const account = (id: string, balance_cents: number): Tables<'accounts_with_balance'> => ({
  ...base,
  id,
  name: `${id} fund`,
  currency: 'AUD',
  deleted_from_source_at: null,
  exclude_from_net_worth: false,
  external_id: null,
  owner_member_id: null,
  source: 'manual',
  type: 'other',
  balance_cents,
})

const assumptions: RetirementAssumptions = {
  retirementAge: 67,
  expectedReturnPct: 7.5,
  inflationPct: 2.5,
  contributionGrowthPct: 1.5,
}

const households = [
  {
    name: 'two members, caps exceeded, a co-contribution and a true-up',
    rows: {
      members: [member('m1', 'Ada'), member('m2', 'Ben')],
      inflows: [
        inflow({ id: 'i1', name: 'Ada salary', amount_cents: 150_000_00 }),
        inflow({
          id: 'i2',
          name: 'Ben wage',
          member_id: 'm2',
          type: 'wage',
          schedule: 'fortnightly',
          hourly_rate_cents: 28_00,
          hours_per_period: 60,
        }),
      ],
      profiles: [
        profile({
          id: 'p1',
          fund_name: 'AusSuper',
          linked_account_id: 'a1',
          balance_as_of: '2026-07-01',
          carry_forward_cap_cents: 5_000_00,
        }),
      ],
      contributions: [
        contribution({ id: 'c1', mode: 'percent', percent_bp: 1_050, frequency: 'annual' }),
        contribution({
          id: 'c2',
          kind: 'personal_deductible',
          amount_cents: 2_500_00,
          frequency: 'monthly',
        }),
        contribution({
          id: 'c3',
          kind: 'personal_non_concessional',
          amount_cents: 140_000_00,
        }),
        contribution({
          id: 'c4',
          member_id: 'm2',
          kind: 'personal_non_concessional',
          amount_cents: 1_000_00,
        }),
      ],
      accounts: [account('a1', 250_000_00)],
    },
    ages: { m1: 35 } as Record<string, number>,
  },
  {
    name: 'a member with no profile and no contributions',
    rows: {
      members: [member('m1', 'Ada')],
      inflows: [],
      profiles: [],
      contributions: [],
      accounts: [],
    },
    ages: { m1: 70 } as Record<string, number>,
  },
]

const figures = (household: (typeof households)[number]) => {
  const { rows, ages } = household
  const caps = superCapSummaryFromRows(
    rows.inflows,
    rows.profiles,
    rows.contributions,
    currentTaxConfig(),
    rows.members,
  )
  const net = netAnnualSuperContributionFromRows(rows.inflows, rows.contributions, rows.members)
  const now = new Date(NOW)
  const members = rows.members.map(({ id }) => {
    const row = rows.profiles.find((candidate) => candidate.member_id === id)
    const linked = rows.accounts.find((candidate) => candidate.id === row?.linked_account_id)
    const netAnnualContributionCents = net.get(id) ?? 0
    return {
      memberId: id,
      caps: caps.get(id) ?? null,
      netAnnualContributionCents,
      effectiveBalanceCents: accruedBalanceCents(
        linked?.balance_cents ?? 0,
        row?.balance_as_of ?? null,
        netAnnualContributionCents,
        now,
      ),
    }
  })
  const projections = members.map((entry) => {
    const age = ages[entry.memberId]
    if (age === undefined) {
      return null
    }
    return {
      ...projectSuperBalance(
        toProjectionInput(
          entry.effectiveBalanceCents,
          entry.netAnnualContributionCents,
          age,
          assumptions,
        ),
      ),
      yearsToRetirement: yearsToRetirement(age, assumptions.retirementAge),
    }
  })
  return {
    summary: {
      preservationAge: currentTaxConfig().super.preservationAge,
      defaultAssumptions: DEFAULT_ASSUMPTIONS,
      members,
    },
    projections,
  }
}

describe('the native Super parity fixture', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('matches what the PWA Super screen computes from the same rows', async () => {
    const text = `${JSON.stringify(
      households.map((household) => ({
        name: household.name,
        rows: household.rows,
        ages: household.ages,
        assumptions,
        expected: figures(household),
      })),
      null,
      2,
    )}\n`
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises both caps, a co-contribution, accrual and a member with no age', () => {
    const first = figures(households[0]!)
    const [ada, ben] = first.summary.members
    expect(ada?.caps?.concessionalOverCap).toBe(true)
    expect(ada?.caps?.nonConcessionalOverCap).toBe(true)
    expect(ben?.caps?.coContributionCents).toBeGreaterThan(0)
    expect(ada?.effectiveBalanceCents).toBeGreaterThan(250_000_00)
    expect(first.projections[1]).toBeNull()
    expect(figures(households[1]!).summary.members[0]?.caps).toBeNull()
  })
})
